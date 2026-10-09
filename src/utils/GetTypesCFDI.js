const config = require('../config');
const portalClient = require('./PortalClient');
const { getOneMonthAgoString } = require('./TimezoneHelper');
const { runQuery } = require('./SQLServerConnection');
const { logGenerator } = require('./LogGenerator');

const url = config.portal.url;
const tenantIds = config.portal.tenants.map(t => t.id);
const apiKeys = config.portal.tenants.map(t => t.key);
const apiSecrets = config.portal.tenants.map(t => t.secret);
const databases = config.portal.tenants.map(t => t.database);

const urlBase = (index) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis`;

// Paginación de las consultas de CFDIs (fase 24): el portal entrega como máximo 200 por página
// y reporta el número real en `total`, así que las páginas se piden hasta completarlo.
const LOG_FILE = 'GetTypesCFDI';
const PAGE_SIZE = 200;
// Tope de páginas por consulta del ciclo: 10,000 comprobantes. El presupuesto de tiempo corta
// mucho antes; el tope sólo impide un bucle infinito (D-08).
const CYCLE_MAX_PAGES = 50;
const MAX_PAGE_ATTEMPTS = 3;
const RETRY_BASE_MS = 1500;
// Presupuesto por consulta del ciclo = 25 % de stepTimeoutMs (75 s con el default de 5 min).
// getTypeE + getTypeI en el mismo paso: 2 × (75 s + 30 s de una petición en vuelo) = 210 s < 300 s
// del paso downloadCFDI; preserva axios 30 s < paso 5 min < hijo 10 min < candado 14 min (D-10).
const LISTING_BUDGET_FRACTION = 0.25;
// Filtro "ya está en Sage" en bloque (fase 24): IN de hasta 200 UUID por consulta.
const SQL_BLOCK_SIZE = 200;
// Listas blancas antes de SQL (D-14, REQ-24-09): sólo estos caracteres llegan como literales, así
// que ninguna comilla, espacio ni punto y coma del portal entra a una consulta. Sin bandera g: con
// ella, .test() guarda lastIndex entre llamadas y alterna resultados.
const UUID_REGEX = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const RFC_REGEX = /^[A-ZÑ&0-9]{12,13}$/i;

async function getTypeP(index) {
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Iniciando procesamiento de CFDI tipo P (PAYMENT_CFDI) para index=${index}`);
    let dateFrom = getOneMonthAgoString();

    try {
        const t0 = Date.now();
        const response = await portalClient.get(
            urlBase(index) +
            `?from=${dateFrom}-01` +
            `&documentTypes=CFDI` +
            `&offset=0&pageSize=0` +
            `&cfdiType=PAYMENT_CFDI`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );
        const pageMs = Date.now() - t0;
        const totalP = parseTotal(response?.data?.total);
        const recibidasP = Array.isArray(response?.data?.items) ? response.data.items.length : 0;
        logPaginationSummary('getTypeP', index, { total: totalP, recibidas: recibidasP, pages: 1, ms: pageMs, slowestPageMs: pageMs, stopReason: (totalP !== null && recibidasP >= totalP) ? 'completo' : 'sin-paginar', failedOffset: null });

        if (response.data.total === 0) {
            console.log('[INFO] No hay CFDI de tipo P');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            if (!item.metadata.payment_info || item.metadata.payment_info.payments.length === 0) {
                if (item.payment_complement_info && item.payment_complement_info[0].payment_id) {
                    const paymentId = item.payment_complement_info[0].payment_id;
                    try {
                        const paymentResponse = await portalClient.get(
                            `${url}/api/1.0/extern/tenants/${tenantIds[index]}/payments/${paymentId}`,
                            {
                                headers: {
                                    'PDPTenantKey': apiKeys[index],
                                    'PDPTenantSecret': apiSecrets[index]
                                }
                            }
                        );

                        if (paymentResponse.data) {
                            item.metadata.payment_info = {
                                payments: [
                                    {
                                        external_id: paymentResponse.data.external_id
                                    }
                                ]
                            };
                        } else {
                            console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por no tener información en el endpoint de pagos`);
                            logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener información en el endpoint de pagos`);
                            continue;
                        }
                    } catch (error) {
                        console.log(`[ERROR] No se pudo obtener información del pago con ID ${paymentId}:`, error.message);
                        logGenerator(logFileName, 'error', `Error al obtener información del pago con ID ${paymentId}: ${error.message}`);
                        continue;
                    }
                } else {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por no tener payment_id`);
                    logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener payment_id`);
                    continue;
                }
            }

            const rfcQuery = `SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${item.cfdi.receptor.rfc}';`;
            try {
                const rfcResult = await runQuery(rfcQuery, 'FESA');
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }

                const cfdiQuery = `SELECT COUNT(*) AS NREG FROM APIBH H, APIBHO O WHERE H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM AND H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND [VALUE] = '${item.cfdi.timbre.uuid}';`;
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por ser ya timbrado`);
                    continue;
                }

                console.log(`[OK] UUID ${item.cfdi.timbre.uuid} conservado`);
                data.push(item);
            } catch (error) {
                console.log(`[ERROR] Error ejecutando consultas SQL para UUID ${item.cfdi.timbre.uuid}: ${error.message}`);
                logGenerator(logFileName, 'error', `Error ejecutando consultas SQL para UUID ${item.cfdi.timbre.uuid}: ${error.message}`);
                continue;
            }
        }

        return data;
    } catch (error) {
        try {
            logGenerator(logFileName, 'error', 'Error al obtener el tipo de comprobante "P" : \n' + error + '\n');
        } catch (err) {
            console.log('Error al enviar notificación: ' + err);
        }
        return [];
    }
}

async function getTypeI(index) {
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Iniciando procesamiento de CFDI tipo I (INVOICE) PENDING_TO_PAY para index=${index}`);
    let dateFrom = getOneMonthAgoString();

    try {
        const page = await fetchCfdiPages(
            index,
            { cfdiType: 'INVOICE', stage: 'PENDING_TO_PAY', from: `${dateFrom}-01`, hideValidations: true },
            { consulta: 'getTypeI', maxPages: CYCLE_MAX_PAGES, budgetMs: listingBudgetMs() }
        );

        if (page.items.length === 0) {
            // "No hay" sólo si el listado terminó de verdad: si falló la primera página o se agotó el
            // presupuesto no se pudo ver, y la causa ya quedó en la línea [PAGINACION] (D-02, REQ-24-05).
            if (page.stopReason === 'completo' || (page.stopReason === 'pagina-vacia' && !(page.total > 0))) {
                console.log('[INFO] No hay CFDI de tipo I');
            }
            return [];
        }

        // Con una página fallida o el presupuesto agotado, page.items trae lo recibido y se filtra igual.
        return await filterNotInSage(index, page.items, 'I', 'getTypeI');
    } catch (error) {
        try {
            logGenerator(logFileName, 'error', 'Error al obtener el tipo de comprobante "I" : \n' + error + '\n');
        } catch (err) {
            console.log('Error al enviar notificacion: ' + err);
            console.log('Error al obtener el tipo de comprobante "I" : \n' + error + '\n');
        }
        return [];
    }
}


async function getTypeIToSend(index) {
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Iniciando procesamiento de CFDI tipo I (INVOICE) TO_SEND para index=${index}`);
    let dateFrom = getOneMonthAgoString();

    try {
        const response = await portalClient.get(
            urlBase(index) +
            `?from=${dateFrom}-01` +
            `&documentTypes=CFDI` +
            `&offset=0&pageSize=0` +
            `&cfdiType=INVOICE` +
            `&status=TO_SEND`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            console.log('[INFO] No hay CFDI de tipo I TO_SEND');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            const uuid = item.cfdi.timbre.uuid;
            const rels = item.cfdi.cfdis_relacionados;
            if (!Array.isArray(rels) || !rels.some(r => r.tipo_relacion === '07')) {
                console.log(`[INFO] UUID ${uuid} eliminado por no tener cfdi_relacionados tipo 07`);
                logGenerator(logFileName, 'info', `UUID ${uuid} eliminado por no tener cfdi_relacionados tipo 07`);
                continue;
            }

            const rfc = item.cfdi.receptor.rfc;
            const rfcQuery = `
                SELECT COUNT(*) AS NREG
                  FROM fesaParam
                 WHERE Parametro = 'RFCReceptor'
                   AND VALOR     = '${rfc}';
            `;
            try {
                const rfcResult = await runQuery(rfcQuery, 'FESA');
                if (rfcResult.recordset[0].NREG === 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por falta de RFCReceptor en fesa`);
                    logGenerator(logFileName, 'info', `UUID ${uuid} eliminado por falta de RFCReceptor en fesa`);
                    continue;
                }
            } catch (err) {
                console.log(`Error ejecutando rfcQuery: ${err.message}`);
                logGenerator(logFileName, 'error', `Error ejecutando rfcQuery para UUID ${uuid}: ${err.stack}`);
                continue;
            }

            const cfdiQuery = `
                SELECT COUNT(*) AS NREG
                  FROM APIBH H
                  JOIN APIBHO O
                    ON H.CNTBTCH = O.CNTBTCH
                   AND H.CNTITEM = O.CNTITEM
                 WHERE H.ERRENTRY = 0
                   AND O.OPTFIELD = 'FOLIOCFD'
                   AND [VALUE]    = '${uuid}';
            `;
            try {
                const cfdiResult = await runQuery(cfdiQuery, databases[index]);
                if (cfdiResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por ser ya timbrado`);
                    continue;
                }
            } catch (err) {
                console.log(`Error ejecutando cfdiQuery: ${err.message}`);
                logGenerator(logFileName, 'error', `Error ejecutando cfdiQuery para UUID ${uuid}: ${err.stack}`);
                continue;
            }

            const poCheckQuery = `
                SELECT COUNT(O.[VALUE]) AS NREG
                  FROM POINVH1 H
                  JOIN POINVHO O ON H.INVHSEQ = O.INVHSEQ
                 WHERE O.OPTFIELD = 'FOLIOCFD'
                   AND O.[VALUE]  = '${uuid}'
            `;
            try {
                const poCheckResult = await runQuery(poCheckQuery, databases[index]);
                if (poCheckResult.recordset[0].NREG > 0) {
                    console.log(`[INFO] UUID ${uuid} eliminado por existir en Sage OC (ya registrado en órdenes de compra)`);
                    continue;
                }
            } catch (err) {
                console.log(`Error ejecutando poCheckQuery: ${err.message}`);
                logGenerator(logFileName, 'error', `Error ejecutando poCheckQuery para UUID ${uuid}: ${err.stack}`);
                continue;
            }

            console.log(`[OK] UUID ${uuid} conservado`);
            data.push(item);
        }

        return data;
    } catch (error) {
        logGenerator(logFileName, 'error', `Error al obtener el tipo de comprobante "I" TO_SEND :\n${error.stack}`);
        return [];
    }
}

async function getTypeE(index) {
    const logFileName = 'GetTypesCFDI';
    logGenerator(logFileName, 'info', `[START] Iniciando procesamiento de CFDI tipo E (CREDIT_NOTE) para index=${index}`);
    let dateFrom = getOneMonthAgoString();

    try {
        const page = await fetchCfdiPages(
            index,
            { cfdiType: 'CREDIT_NOTE', from: `${dateFrom}-01`, hideValidations: true },
            { consulta: 'getTypeE', maxPages: CYCLE_MAX_PAGES, budgetMs: listingBudgetMs() }
        );

        if (page.items.length === 0) {
            // Misma regla que getTypeI: "no hay" sólo si el listado terminó de verdad (D-02).
            if (page.stopReason === 'completo' || (page.stopReason === 'pagina-vacia' && !(page.total > 0))) {
                console.log('[INFO] No hay CFDI de tipo E');
            }
            return [];
        }

        return await filterNotInSage(index, page.items, 'E', 'getTypeE');
    } catch (error) {
        logGenerator(logFileName, 'error', `Error al obtener el tipo de comprobante "E": \n${error}\n`);
        return [];
    }
}


/**
 * Obtiene CFDIs PENDING_TO_PAY de tipo INVOICE filtrados por provider_id.
 * Pagina hasta el `total` del portal pidiendo `providerId` y `hideValidations=true`, dentro del
 * presupuesto de tiempo del ciclo; si una página falla o se agota el presupuesto, devuelve lo
 * recibido. Conserva el filtro local por metadata.provider_id por si el portal ignorara el
 * parámetro. Con providerId vacío devuelve [] sin consultar el portal (D-31).
 * @param {number} index - Índice del tenant.
 * @param {string} providerId - ID del proveedor en el portal.
 * @returns {Promise<Array>} - CFDIs del proveedor.
 */
async function getCfdisByProvider(index, providerId) {
    if (providerId == null || String(providerId).trim() === '') {
        logGenerator(LOG_FILE, 'warn', `[PAGINACION-OMITIDA] consulta=getCfdisByProvider tenant=${tenantIds[index]} motivo=proveedor-vacio`);
        return [];
    }

    const logFileName = 'GetTypesCFDI';
    const dateFrom = getOneMonthAgoString();

    try {
        const r = await fetchCfdiPages(
            index,
            { cfdiType: 'INVOICE', stage: 'PENDING_TO_PAY', from: `${dateFrom}-01`, providerId, hideValidations: true },
            { consulta: 'getCfdisByProvider', maxPages: CYCLE_MAX_PAGES, budgetMs: listingBudgetMs() }
        );

        return r.items.filter(item => item?.metadata?.provider_id === providerId);
    } catch (error) {
        console.error(`[ERROR] getCfdisByProvider: ${error.message}`);
        logGenerator(logFileName, 'error', `getCfdisByProvider failed for provider ${providerId}: ${error.message}`);
        return [];
    }
}

function isRetryablePortalError(error) {
    const retryableStatus = [429, 502, 503, 504];
    const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN'];
    const status = error?.response?.status;
    const code = error?.code;

    return retryableStatus.includes(status) || retryableCodes.includes(code);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Presupuesto de una consulta del ciclo, en ms. Se lee en cada llamada, nunca al cargar el módulo. */
function listingBudgetMs() {
    return Math.floor(config.schedule.stepTimeoutMs * LISTING_BUDGET_FRACTION);
}

/** `total` del portal como número >= 0, o null si no viene o no es un número válido. */
function parseTotal(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }
    return null;
}

/** Valor externo para el log: entre comillas, máximo 64 caracteres y sin saltos de línea crudos. */
function valorLog(value) {
    return JSON.stringify(String(value).slice(0, 64));
}

/** Identificador para el log: tal cual si es simple; si no, escapado con valorLog. */
function idLog(value) {
    if (value === null || value === undefined) return '-';
    const text = String(value);
    return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : valorLog(value);
}

/**
 * Escribe la línea [PAGINACION] de una consulta (D-17): info si llegó todo lo que el portal
 * reportó, warn si no, con la causa en corte=. Nunca incluye la URL ni las cabeceras.
 */
function logPaginationSummary(consulta, index, resumen) {
    const { recibidas, pages, ms, slowestPageMs, stopReason, failedOffset, proveedor } = resumen;
    const total = resumen.total === undefined ? null : resumen.total;

    let linea = `[PAGINACION] consulta=${consulta} tenant=${tenantIds[index]}` +
        ` total=${total === null ? 'desconocido' : total} recibidas=${recibidas} paginas=${pages}` +
        ` ms=${ms} pagina_mas_lenta_ms=${slowestPageMs} corte=${stopReason}`;
    if (stopReason === 'pagina-fallida') {
        linea += ` offset_fallido=${failedOffset}`;
    }
    if (proveedor !== null && proveedor !== undefined && proveedor !== '') {
        linea += ` proveedor=${idLog(proveedor)}`;
    }

    let nivel;
    if (total !== null) {
        nivel = recibidas < total ? 'warn' : 'info';
    } else {
        nivel = ['pagina-fallida', 'presupuesto', 'tope-paginas', 'sin-avance'].includes(stopReason) ? 'warn' : 'info';
    }
    logGenerator(LOG_FILE, nivel, linea);
}

/**
 * Pide una página con reintento (D-09): hasta 3 intentos, esperando intento × 1500 ms ante
 * 429/502/503/504 o errores de red. Antes de cada intento y de cada espera revisa el presupuesto
 * (D-10): si la espera terminaría después del límite, no espera ni reintenta. Nunca lanza.
 * @returns {Promise<{ok: true, response: Object}|{ok: false, reason: string, error: Error|null}>}
 */
async function requestCfdiPage(index, url, ctx) {
    const { consulta, offset, deadline } = ctx;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
        if (deadline !== null && Date.now() >= deadline) {
            return { ok: false, reason: 'presupuesto', error: lastError };
        }

        try {
            const response = await portalClient.get(url, {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            });
            return { ok: true, response };
        } catch (error) {
            lastError = error;
            const status = error?.response?.status || error?.code || 'N/A';
            const intento = `[PAGINACION-INTENTO] consulta=${consulta} tenant=${tenantIds[index]}` +
                ` offset=${offset} intento=${attempt}/${MAX_PAGE_ATTEMPTS} status=${idLog(status)}`;

            if (attempt < MAX_PAGE_ATTEMPTS && isRetryablePortalError(error)) {
                const espera = attempt * RETRY_BASE_MS;
                if (deadline !== null && Date.now() + espera >= deadline) {
                    logGenerator(LOG_FILE, 'warn', `${intento} accion=presupuesto`);
                    return { ok: false, reason: 'presupuesto', error };
                }
                const linea = `${intento} accion=reintentar espera_ms=${espera}`;
                console.warn(linea);
                logGenerator(LOG_FILE, 'warn', linea);
                await sleep(espera);
                continue;
            }

            logGenerator(LOG_FILE, 'warn', `${intento} accion=abandonar`);
            return { ok: false, reason: 'pagina-fallida', error };
        }
    }

    return { ok: false, reason: 'pagina-fallida', error: lastError };
}

/**
 * Única paginación de las consultas de CFDIs (REQ-24-02). Pide las páginas en serie hasta
 * completar el `total` del portal y nunca lanza por un fallo de página (D-02): devuelve lo
 * recibido y la causa del corte, y el llamador decide qué hacer con eso.
 *
 * Cortes después de cada página, en este orden (D-04): página vacía, página sin ningún UUID
 * nuevo, únicos >= total y tope de páginas; antes de cada página se revisa el presupuesto. No hay
 * regla de página corta (D-05): si el portal bajara su tope de página, se sigue hasta `total`.
 * Deduplica por UUID normalizado (o por id del portal) conservando la primera aparición (D-07).
 *
 * @param {number} index - Índice del tenant.
 * @param {Object} query - { cfdiType, stage, from, to, providerId, hideValidations }
 * @param {Object} opts - { consulta, maxPages, budgetMs, pageSize }; budgetMs null = sin presupuesto.
 * @returns {Promise<Object>} - { items, total, pages, ms, slowestPageMs, stopReason, failedOffset, raw, error }
 */
async function fetchCfdiPages(index, query, opts) {
    const pageSize = opts.pageSize || PAGE_SIZE;
    const maxPages = opts.maxPages || CYCLE_MAX_PAGES;
    const start = Date.now();
    const deadline = opts.budgetMs == null ? null : start + opts.budgetMs;

    let filtrosUrl = '';
    const filtros = [
        ['cfdiType', query.cfdiType],
        ['stage', query.stage],
        ['from', query.from],
        ['to', query.to],
        ['providerId', query.providerId]
    ];
    for (const [nombre, valor] of filtros) {
        if (valor !== null && valor !== undefined && valor !== '') {
            filtrosUrl += `&${nombre}=${encodeURIComponent(valor)}`;
        }
    }
    if (query.hideValidations === true) {
        filtrosUrl += '&hideValidations=true';
    }

    const items = [];
    const seen = new Set();
    let offset = 0;
    let pages = 0;
    let raw = 0;
    let total = null;
    let firstTotal = null;
    let slowestPageMs = 0;
    let stopReason = null;
    let failedOffset = null;
    let error = null;

    while (stopReason === null) {
        if (deadline !== null && Date.now() >= deadline) {
            stopReason = 'presupuesto';
            break;
        }

        const pageUrl = urlBase(index) +
            `?documentTypes=CFDI&offset=${encodeURIComponent(offset)}&pageSize=${encodeURIComponent(pageSize)}` +
            filtrosUrl;
        const pageStart = Date.now();
        const res = await requestCfdiPage(index, pageUrl, { consulta: opts.consulta, offset, deadline });
        slowestPageMs = Math.max(slowestPageMs, Date.now() - pageStart);

        if (!res.ok) {
            stopReason = res.reason;
            error = res.error;
            if (res.reason === 'pagina-fallida') {
                failedOffset = offset;
            }
            break;
        }

        pages++;
        const pageItems = Array.isArray(res.response?.data?.items) ? res.response.data.items : [];
        raw += pageItems.length;
        if (pages === 1) {
            firstTotal = parseTotal(res.response?.data?.total);
            total = firstTotal > 0 ? firstTotal : null;
        }

        let nuevos = 0;
        for (const item of pageItems) {
            const uuid = item?.cfdi?.timbre?.uuid;
            let clave = null;
            if (typeof uuid === 'string' && uuid.trim() !== '') {
                clave = uuid.trim().toUpperCase();
            } else if (item?.id) {
                clave = 'id:' + String(item.id);
            }
            if (clave === null || !seen.has(clave)) {
                if (clave !== null) seen.add(clave);
                items.push(item);
                nuevos++;
            }
        }
        offset += pageItems.length;

        if (pageItems.length === 0) {
            if (pages === 1 && firstTotal === 0) {
                stopReason = 'completo';
                total = 0;
            } else {
                stopReason = 'pagina-vacia';
            }
        } else if (nuevos === 0) {
            stopReason = 'sin-avance';
        } else if (total !== null && items.length >= total) {
            stopReason = 'completo';
        } else if (pages >= maxPages) {
            stopReason = 'tope-paginas';
        }
    }

    const ms = Date.now() - start;
    logPaginationSummary(opts.consulta, index, {
        total,
        recibidas: items.length,
        pages,
        ms,
        slowestPageMs,
        stopReason,
        failedOffset,
        proveedor: query.providerId
    });

    return { items, total, pages, ms, slowestPageMs, stopReason, failedOffset, raw, error };
}

/**
 * Filtro "ya está en Sage" en bloque (D-12 a D-19). Decide lo mismo que el filtro por factura
 * anterior: se descarga sólo si el RFC receptor está registrado en FESA y el UUID no está en CxP
 * ni en OC (facturas, kind 'I') o en NC (notas de crédito, kind 'E'), con la misma precedencia
 * RFC → CxP → OC/NC. En vez de 3 consultas por factura hace, en serie, una por RFC distinto y una
 * por cada bloque de 200 UUID en CxP y en OC/NC: como máximo 2 × ceil(U / 200) + R (D-16).
 *
 * Sólo valores que pasaron UUID_REGEX o RFC_REGEX llegan al SQL (D-14). El IN lleva cada UUID
 * recortado tal como lo entregó el portal y las filas se cruzan en mayúsculas, así que encuentra lo
 * mismo que el `=` anterior con cualquier intercalación de la base (D-13). Un item malformado o una
 * consulta que falla sólo apartan a sus propias facturas (D-15); una excepción inesperada devuelve
 * [] para no descargar nada sin verificar. Todo el estado es local a la llamada (always-on).
 *
 * @param {number} index - Índice del tenant.
 * @param {Array} items - Items del portal, en su orden.
 * @param {string} kind - 'I' (facturas, POINVHO) o 'E' (notas de crédito, POCRNHO).
 * @param {string} consulta - Nombre de la consulta para el log (getTypeI o getTypeE).
 * @returns {Promise<Array>} - Los items a descargar, en el orden de entrada y sin modificar.
 */
async function filterNotInSage(index, items, kind, consulta) {
    const t0 = Date.now();

    try {
        const tenant = tenantIds[index];

        // Validación (REQ-24-09): un item malformado sólo se aparta a sí mismo.
        const registros = [];
        for (const item of items) {
            const rawUuid = item?.cfdi?.timbre?.uuid;
            const registro = { item, rawUuid, uuid: null, key: null, rfc: null, resultado: null, detalle: null };
            if (typeof rawUuid !== 'string' || rawUuid.trim() === '') {
                registro.resultado = 'invalida';
                registro.detalle = 'uuid-ausente';
            } else if (!UUID_REGEX.test(rawUuid.trim())) {
                registro.resultado = 'invalida';
                registro.detalle = 'uuid-invalido';
            } else {
                registro.uuid = rawUuid.trim();
                registro.key = registro.uuid.toUpperCase();
                const rawRfc = item?.cfdi?.receptor?.rfc;
                if (typeof rawRfc !== 'string' || rawRfc.trim() === '') {
                    registro.resultado = 'invalida';
                    registro.detalle = 'rfc-ausente';
                } else if (!RFC_REGEX.test(rawRfc.trim())) {
                    registro.resultado = 'invalida';
                    registro.detalle = 'rfc-invalido valor=' + valorLog(rawRfc);
                } else {
                    registro.rfc = rawRfc.trim();
                }
            }
            registros.push(registro);
        }

        // Una consulta que falla aparta sólo a sus facturas y deja su línea de error (D-15).
        const errorDeBloque = (lote, tabla, bloque, err) => {
            for (const registro of lote) {
                registro.resultado = 'error-sql';
                registro.detalle = `tabla=${tabla} bloque=${bloque}`;
            }
            logGenerator(LOG_FILE, 'error', `[FILTRO-SAGE] consulta=${consulta} tenant=${tenant} tabla=${tabla}` +
                ` bloque=${bloque} tamano=${lote.length} error=${valorLog(err?.message ?? err)}`);
        };

        // RFC receptor: una consulta por RFC distinto (texto recortado exacto, en orden de primera
        // aparición), la misma de antes y contra FESA.
        const porRfc = new Map();
        for (const registro of registros) {
            if (registro.resultado === null) {
                if (!porRfc.has(registro.rfc)) porRfc.set(registro.rfc, []);
                porRfc.get(registro.rfc).push(registro);
            }
        }
        let bloqueRfc = 0;
        for (const [rfc, lote] of porRfc) {
            bloqueRfc++;
            try {
                const res = await runQuery(`SELECT COUNT(*) AS NREG FROM fesaParam WHERE Parametro = 'RFCReceptor' AND VALOR = '${rfc}';`, 'FESA');
                if (Number(res.recordset[0].NREG) === 0) {
                    for (const registro of lote) {
                        registro.resultado = 'sin-rfc';
                        registro.detalle = 'rfc_receptor=' + rfc;
                    }
                }
            } catch (err) {
                errorDeBloque(lote, 'fesaParam', bloqueRfc, err);
            }
        }

        // Los que siguen pendientes, en bloques de SQL_BLOCK_SIZE con los UUID tal como vinieron
        // del portal; las filas se cruzan recortadas y en mayúsculas ([VALUE] puede traer espacios finales).
        const porBloques = async (tabla, armarSql, siNoEsta) => {
            const pendientes = registros.filter(registro => registro.resultado === null);
            for (let inicio = 0; inicio < pendientes.length; inicio += SQL_BLOCK_SIZE) {
                const bloque = inicio / SQL_BLOCK_SIZE + 1;
                const lote = pendientes.slice(inicio, inicio + SQL_BLOCK_SIZE);
                const literales = [...new Set(lote.map(registro => registro.uuid))].map(u => `'${u}'`).join(', ');
                try {
                    const res = await runQuery(armarSql(literales), databases[index]);
                    const enSage = new Set(res.recordset.map(row => String(row.U).trim().toUpperCase()));
                    for (const registro of lote) {
                        registro.resultado = enSage.has(registro.key) ? 'ya-en-sage' : siNoEsta;
                    }
                } catch (err) {
                    errorDeBloque(lote, tabla, bloque, err);
                }
            }
        };

        // CxP: lo que no está sigue pendiente y pasa a OC/NC; un bloque con error no pasa.
        await porBloques('APIBHO', (literales) =>
            `SELECT DISTINCT O.[VALUE] AS U FROM APIBH H JOIN APIBHO O ON H.CNTBTCH = O.CNTBTCH AND H.CNTITEM = O.CNTITEM WHERE H.ERRENTRY = 0 AND O.OPTFIELD = 'FOLIOCFD' AND O.[VALUE] IN (${literales})`,
            null);

        // Facturas contra OC y notas de crédito contra NC, igual que antes; lo que no está se descarga.
        if (kind === 'E') {
            await porBloques('POCRNHO', (literales) =>
                `SELECT DISTINCT O.[VALUE] AS U FROM POCRNH1 H JOIN POCRNHO O ON H.CRNHSEQ = O.CRNHSEQ WHERE O.OPTFIELD = 'FOLIOCFD' AND O.[VALUE] IN (${literales})`,
                'a-descargar');
        } else {
            await porBloques('POINVHO', (literales) =>
                `SELECT DISTINCT O.[VALUE] AS U FROM POINVH1 H JOIN POINVHO O ON H.INVHSEQ = O.INVHSEQ WHERE O.OPTFIELD = 'FOLIOCFD' AND O.[VALUE] IN (${literales})`,
                'a-descargar');
        }

        // Una línea por factura sólo para lo que se descarga y las anomalías (D-19); las que ya
        // están en Sage sólo suman al contador.
        const niveles = { 'a-descargar': 'info', 'sin-rfc': 'info', 'invalida': 'warn', 'error-sql': 'error' };
        const cuenta = { 'ya-en-sage': 0, 'sin-rfc': 0, 'invalida': 0, 'error-sql': 0, 'a-descargar': 0 };
        for (const registro of registros) {
            cuenta[registro.resultado]++;
            const nivel = niveles[registro.resultado];
            if (nivel) {
                const u = registro.uuid !== null ? registro.uuid : valorLog(registro.rawUuid ?? '');
                const detalle = registro.detalle ? ` detalle=${registro.detalle}` : '';
                logGenerator(LOG_FILE, nivel, `[FILTRO-SAGE] consulta=${consulta} UUID=${u} id=${idLog(registro.item?.id)}` +
                    ` resultado=${registro.resultado}${detalle}`);
            }
        }

        // Resumen (D-18): los cinco contadores suman recibidas; warn si hubo anomalías.
        const anomalias = cuenta['invalida'] + cuenta['error-sql'];
        logGenerator(LOG_FILE, anomalias > 0 ? 'warn' : 'info',
            `[FILTRO-SAGE] consulta=${consulta} tenant=${tenant} recibidas=${items.length} ya_en_sage=${cuenta['ya-en-sage']}` +
            ` sin_rfc=${cuenta['sin-rfc']} invalidas=${cuenta['invalida']} error_sql=${cuenta['error-sql']}` +
            ` a_descargar=${cuenta['a-descargar']} ms=${Date.now() - t0}`);

        return registros.filter(registro => registro.resultado === 'a-descargar').map(registro => registro.item);
    } catch (err) {
        logGenerator(LOG_FILE, 'error', `[FILTRO-SAGE] consulta=${consulta} tenant=${tenantIds[index]} error_inesperado=${valorLog(err?.message ?? err)}`);
        return [];
    }
}

/**
 * Fetches ALL PENDING_TO_PAY invoices from the portal without any Sage-side
 * filtering or date constraints. Returns every invoice the portal considers unpaid.
 * Contrato "todo o nada" (REQ-24-03): si una página falla tras los reintentos devuelve [], porque
 * los scripts de conciliación leen "no está en la lista" como "no está en el portal". Sin
 * presupuesto de tiempo: no corre dentro del paso del ciclo.
 * @param {number} index - Tenant index.
 * @param {Object} [options] - Optional paging and filter settings.
 * @param {number} [options.pageSize=200] - Page size for portal pagination.
 * @param {number} [options.maxPages=1000] - Safety cap for page iterations.
 * @param {string|null} [options.from=null] - Optional from date (YYYY-MM-DD).
 * @param {string|null} [options.to=null] - Optional to date (YYYY-MM-DD).
 * @returns {Promise<Array>} - Raw portal items array.
 */
async function getPendingToPayInvoices(index, options = {}) {
    const logFileName = 'GetTypesCFDI';
    const pageSize = options.pageSize || 200;
    const maxPages = options.maxPages || 1000;
    const from = options.from || null;
    const to = options.to || null;

    logGenerator(
        logFileName,
        'info',
        `[START] Fetching PENDING_TO_PAY invoices (paged) index=${index}, pageSize=${pageSize}, from=${from || 'N/A'}, to=${to || 'N/A'}`
    );

    try {
        const r = await fetchCfdiPages(
            index,
            { cfdiType: 'INVOICE', stage: 'PENDING_TO_PAY', from, to },
            { consulta: 'getPendingToPayInvoices', maxPages, budgetMs: null, pageSize }
        );

        if (r.stopReason === 'pagina-fallida') {
            const msg = r.error?.message || 'error desconocido';
            console.error(`[ERROR] getPendingToPayInvoices: ${msg}`);
            logGenerator(
                logFileName,
                'error',
                `getPendingToPayInvoices failed: ${msg} (status=${r.error?.response?.status || 'N/A'})`
            );
            return [];
        }

        if (r.items.length === 0) {
            console.log('[INFO] No PENDING_TO_PAY invoices found in portal');
            return [];
        }

        console.log(`[INFO] Portal returned ${r.items.length} PENDING_TO_PAY invoices (raw=${r.raw})`);
        return r.items;
    } catch (error) {
        console.error(`[ERROR] getPendingToPayInvoices: ${error.message}`);
        logGenerator(
            logFileName,
            'error',
            `getPendingToPayInvoices failed: ${error.message} (status=${error?.response?.status || 'N/A'})`
        );
        return [];
    }
}

module.exports = {
    getTypeP,
    getTypeI,
    getTypeIToSend,
    getTypeE,
    getCfdisByProvider,
    getPendingToPayInvoices
}