/**
 * Modelos de prueba para src/utils/GetTypesCFDI.js (fase 24, D-22 y D-23).
 *
 * - createPortal: modela GET .../cfdis del portal con sus reglas reales: entrega como
 *   máximo 200 por página (pageSize inválido o mayor al tope => 200), respeta offset,
 *   reporta `total`, puede fallar por intento, tardar (reloj falso) y filtrar por providerId.
 * - createSageDb: modela las tablas que consulta el filtro "ya está en Sage" (fesaParam en
 *   FESA; APIBHO, POINVHO y POCRNHO en la base del tenant) con intercalación CI o CS,
 *   espacios finales, ERRENTRY/OPTFIELD y respuesta { recordset }. Responde igual a las
 *   consultas por factura del código anterior y a las de bloque del nuevo (D-23): por eso
 *   sirve para la prueba negativa y para la paridad.
 *
 * Lo comparten tests/utils/GetTypesCFDI.paginacion.test.js (24-01) y
 * tests/utils/GetTypesCFDI.filtro.test.js (24-02). No termina en .test.js, así que jest no
 * lo corre como suite. El objeto `jest` lo inyecta el entorno de jest a cada módulo: aquí
 * sólo se usa dentro de funciones, de modo que el archivo también carga con node.
 */

const PAGINACION_LINE = /^\[PAGINACION\] consulta=(getTypeI|getTypeE|getCfdisByProvider|getPendingToPayInvoices|getTypeP) tenant=\S+ total=(\d+|desconocido) recibidas=\d+ paginas=\d+ ms=\d+ pagina_mas_lenta_ms=\d+ corte=(completo|pagina-vacia|sin-avance|presupuesto|tope-paginas|pagina-fallida|sin-paginar)( offset_fallido=\d+)?( proveedor=.+)?$/;
const FILTRO_RESUMEN_LINE = /^\[FILTRO-SAGE\] consulta=(getTypeI|getTypeE) tenant=\S+ recibidas=\d+ ya_en_sage=\d+ sin_rfc=\d+ invalidas=\d+ error_sql=\d+ a_descargar=\d+ ms=\d+$/;
const FILTRO_FACTURA_LINE = /^\[FILTRO-SAGE\] consulta=(getTypeI|getTypeE) UUID=.+ id=.+ resultado=(a-descargar|sin-rfc|invalida|error-sql)( detalle=.*)?$/;

/**
 * UUID determinista con letras en el prefijo: así makeUuid(n).toLowerCase() siempre
 * difiere de makeUuid(n) y los casos de mayúsculas/minúsculas prueban algo.
 */
function makeUuid(n) {
    return 'ABCDEF00-0000-4000-8000-' + n.toString(16).toUpperCase().padStart(12, '0');
}

/**
 * Item con la forma real del portal (los campos que consumen SageConnect y sus tests).
 * opts: id, providerId, rfc, uuid, sinReceptor, sinTimbre.
 */
function makeItem(n, opts = {}) {
    const item = {
        id: opts.id || 'cfdi-' + n,
        metadata: {
            provider_id: opts.providerId || 'PROV1',
            additional_info: [],
            additional_amount: null,
            payment_info: { payments: [{ external_id: 'PY' + n }] }
        },
        cfdi: {
            folio: String(n),
            serie: 'A',
            receptor: { rfc: 'rfc' in opts ? opts.rfc : 'AAA010101AAA' },
            timbre: { uuid: 'uuid' in opts ? opts.uuid : makeUuid(n) }
        }
    };
    if (opts.sinReceptor) delete item.cfdi.receptor;
    if (opts.sinTimbre) delete item.cfdi.timbre;
    return item;
}

/** Items start..start+count-1 (start = 1 por defecto); el resto de opts va a makeItem. */
function makeItems(count, opts = {}) {
    const { start = 1, ...rest } = opts;
    const items = [];
    for (let i = 0; i < count; i++) {
        items.push(makeItem(start + i, rest));
    }
    return items;
}

/** Error HTTP con la forma de axios (error.response.status). */
function httpError(status) {
    const error = new Error('Request failed with status code ' + status);
    error.response = { status };
    return error;
}

/** Error de red con la forma de axios (error.code). */
function netError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

/**
 * Modelo del endpoint de CFDIs del portal.
 *
 * scenario:
 *   items            lista completa del portal (en su orden: más nuevas primero)
 *   total            número reportado; 'omit' => la respuesta no trae total; por defecto, el largo de la lista
 *   pageCap          tope real de página (200)
 *   pages            { [offset]: items } para páginas fijas
 *   generate         (offset, tamaño) => items, para listas sintéticas enormes
 *   ignoreOffset     portal que siempre devuelve la primera página
 *   honorProviderId  false => ignora el parámetro providerId
 *   failures         { [offset]: [status | código de red, ...] } por intento; agotada la lista, responde bien
 *   delayMs          número o (offset, intento) => ms; adelanta el reloj falso antes de responder o fallar
 *
 * Devuelve { get, calls, stats }; stats.maxInFlight es el máximo de peticiones simultáneas.
 */
function createPortal(scenario = {}) {
    const calls = [];
    const stats = { maxInFlight: 0 };
    const attempts = {};
    let inFlight = 0;

    async function get(url, config) {
        inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
        try {
            // Cede el turno: si alguien pidiera páginas en paralelo, aquí se notaría.
            await Promise.resolve();

            const parsed = new URL(url);
            if (!parsed.pathname.endsWith('/cfdis')) {
                throw new Error('URL no modelada: ' + url);
            }
            const params = Object.fromEntries(parsed.searchParams);
            calls.push({ url, params, headers: config && config.headers });

            const offset = Number(params.offset || 0);
            attempts[offset] = (attempts[offset] || 0) + 1;
            const intento = attempts[offset];

            const pageCap = scenario.pageCap || 200;
            const requested = Number(params.pageSize);
            const size = (!(requested > 0) || requested > pageCap) ? pageCap : requested;

            const delay = typeof scenario.delayMs === 'function'
                ? scenario.delayMs(offset, intento)
                : (scenario.delayMs || 0);
            if (delay > 0) {
                jest.setSystemTime(Date.now() + delay);
            }

            const failures = scenario.failures && scenario.failures[offset];
            if (failures && intento <= failures.length) {
                const failure = failures[intento - 1];
                throw typeof failure === 'number' ? httpError(failure) : netError(failure);
            }

            let lista = scenario.items || [];
            if (params.providerId !== undefined && scenario.honorProviderId !== false) {
                lista = lista.filter(item => item.metadata && item.metadata.provider_id === params.providerId);
            }

            let pageItems;
            if (scenario.generate) {
                pageItems = scenario.generate(offset, size);
            } else if (scenario.pages && Object.prototype.hasOwnProperty.call(scenario.pages, offset)) {
                pageItems = scenario.pages[offset];
            } else if (scenario.ignoreOffset) {
                pageItems = lista.slice(0, size);
            } else {
                pageItems = lista.slice(offset, offset + size);
            }

            if (scenario.total === 'omit') {
                return { data: { items: pageItems } };
            }
            return { data: { items: pageItems, total: scenario.total ?? lista.length } };
        } finally {
            inFlight--;
        }
    }

    return { get, calls, stats };
}

/** Igualdad de SQL Server: ignora espacios finales; CI compara sin mayúsculas, CS exacto. */
function sqlEquals(a, b, collation) {
    const x = String(a).replace(/ +$/, '');
    const y = String(b).replace(/ +$/, '');
    return collation === 'CI' ? x.toUpperCase() === y.toUpperCase() : x === y;
}

const TABLAS = [
    { re: /fesaParam/i, table: 'rfcs', name: 'fesaParam' },
    { re: /APIBHO/i, table: 'cxp', name: 'APIBHO' },
    { re: /POINVHO/i, table: 'oc', name: 'POINVHO' },
    { re: /POCRNHO/i, table: 'nc', name: 'POCRNHO' }
];

function filaDe(row) {
    return typeof row === 'string'
        ? { value: row, errentry: 0, optfield: 'FOLIOCFD' }
        : { errentry: 0, optfield: 'FOLIOCFD', ...row };
}

/**
 * Modelo de la base de Sage para el filtro "ya está en Sage".
 *
 * dataset: { rfcs: [string], cxp: [string | { value, errentry = 0, optfield = 'FOLIOCFD' }], oc: [...], nc: [...] }
 * options: { collation = 'CI', tenantDb = 'DB1', failOn({ table, sql, db, n }) }
 *   (table es la llave del dataset: rfcs, cxp, oc o nc; n = número de consulta a esa tabla, desde 1)
 *
 * runQuery(sql, db) registra { sql, db, table } en calls. Con COUNT( responde
 * { recordset: [{ NREG }] }; si no, { recordset: [{ U }, ...] } sin repetidos y con el
 * valor tal como está guardado (puede traer espacios finales, como un char(60)).
 */
function createSageDb(dataset = {}, options = {}) {
    const { collation = 'CI', tenantDb = 'DB1', failOn } = options;
    const calls = [];
    const stats = { maxInFlight: 0 };
    const counts = {};
    let inFlight = 0;

    async function runQuery(sql, db) {
        inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
        try {
            // Cede el turno: si alguien lanzara consultas en paralelo, aquí se notaría.
            await Promise.resolve();

            const tabla = TABLAS.find(t => t.re.test(sql));
            calls.push({ sql, db, table: tabla ? tabla.table : null });
            if (!tabla) {
                throw new Error('SQL no modelado');
            }

            counts[tabla.table] = (counts[tabla.table] || 0) + 1;
            const n = counts[tabla.table];

            const dbEsperada = tabla.table === 'rfcs' ? 'FESA' : tenantDb;
            if (db !== dbEsperada) {
                throw new Error(`Invalid object name '${tabla.name}'`);
            }
            if (failOn && failOn({ table: tabla.table, sql, db, n })) {
                throw new Error('fallo simulado en ' + tabla.table);
            }

            let literales;
            const inMatch = /\bIN\s*\(([^)]*)\)/i.exec(sql);
            if (inMatch) {
                literales = [...inMatch[1].matchAll(/'([^']*)'/g)].map(m => m[1]);
            } else {
                const eq = tabla.table === 'rfcs'
                    ? /VALOR\s*=\s*'([^']*)'/i.exec(sql)
                    : /\[VALUE\]\s*=\s*'([^']*)'/i.exec(sql);
                literales = eq ? [eq[1]] : [];
            }

            let candidatas = tabla.table === 'rfcs'
                ? (dataset.rfcs || []).map(value => ({ value }))
                : (dataset[tabla.table] || []).map(filaDe);
            if (tabla.table === 'cxp' && /\bERRENTRY\s*=\s*0\b/i.test(sql)) {
                candidatas = candidatas.filter(fila => fila.errentry === 0);
            }
            if (tabla.table !== 'rfcs' && /\bOPTFIELD\s*=\s*'FOLIOCFD'/i.test(sql)) {
                candidatas = candidatas.filter(fila => fila.optfield === 'FOLIOCFD');
            }

            const coincidencias = candidatas.filter(fila => literales.some(l => sqlEquals(fila.value, l, collation)));

            if (/COUNT\(/i.test(sql)) {
                return { recordset: [{ NREG: coincidencias.length }] };
            }
            const valores = [...new Set(coincidencias.map(fila => fila.value))];
            return { recordset: valores.map(value => ({ U: value })) };
        } finally {
            inFlight--;
        }
    }

    return { runQuery, calls, stats };
}

/** Llamadas a logGenerator de un archivo de log, como { level, msg }. */
function logLines(mockFn, fileName = 'GetTypesCFDI') {
    return mockFn.mock.calls
        .filter(call => call[0] === fileName)
        .map(call => ({ level: call[1], msg: String(call[2]) }));
}

module.exports = {
    makeUuid,
    makeItem,
    makeItems,
    httpError,
    netError,
    createPortal,
    createSageDb,
    sqlEquals,
    logLines,
    PAGINACION_LINE,
    FILTRO_RESUMEN_LINE,
    FILTRO_FACTURA_LINE
};
