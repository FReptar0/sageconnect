// Fase 20.7 (D-01, D-16 a D-19): registro diario de pagos en disco. Es la fuente del resumen
// diario para el lado de pagos: lo que se subió, lo que el portal rechazó y lo que se detuvo por
// datos de Sage (RD-04, RD-06, RD-07 y RD-10).
//
// Por qué existe: la tabla de control de pagos no puede guardar un fallo sin sacar el pago de los
// reintentos, porque cualquier fila lo da por subido (CR-03). Este archivo guarda lo que la base no
// puede: qué pagos vio cada corrida de cada empresa y con qué resultado.
//
// Un archivo por día, en la carpeta de bitácoras de ese día
// (<LOG_PATH>/sageconnect/<YYYY-MM-DD>/daily-summary-payments.json), con una entrada por pago
// distinto que guarda su último resultado. El tamaño crece con los pagos distintos del día y no con
// las corridas, y cada texto va acotado (CLAUDE.md §3).
//
// La escritura es síncrona de punta a punta: leer, mezclar, escribir el temporal y renombrar, sin
// ceder el hilo en medio. Así dos volcados no se pueden intercalar, ni siquiera cuando la
// continuación fantasma de un paso que venció su tiempo termina tarde (D-18; el envoltorio de pasos
// no cancela la promesa que envuelve, src/utils/duration.js:37-48). recordPaymentRun nunca lanza:
// cualquier falla vuelve como { ok: false, error } y el archivo anterior queda intacto.
//
// El módulo no lee config ni ningún reloj: la raíz de bitácoras, la fecha y la hora de la corrida
// llegan como argumentos. Tampoco guarda estado de módulo: a nivel de módulo solo hay constantes
// inmutables, y las expresiones regulares van como literales dentro de las funciones.

const fs = require('fs');
const path = require('path');
const { writeSentinelAtomically } = require('./EomNotification');

// D-16: nombre del archivo dentro de la carpeta del día.
const LEDGER_FILE_NAME = 'daily-summary-payments.json';

// D-17: los resultados posibles de un pago en una corrida. Cualquier otro se ignora al mezclar.
const LEDGER_OUTCOMES = Object.freeze(['uploaded', 'rejected', 'no-response', 'no-provider-id', 'missing-uuid', 'no-invoices']);

// D-16: versión del formato. Un archivo de otra versión cuenta como dañado.
const LEDGER_VERSION = 1;

// RD-10: cotas de cada entrada, para que un texto o una lista enorme no hagan crecer el archivo.
const MAX_TEXT_LENGTH = 500;
const MAX_INVOICES = 50;

function isDateText(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isStampText(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value) {
    return Number.isInteger(value) && value >= 0;
}

// Valor PROPIO de un objeto leído del disco, nunca uno heredado del prototipo.
function ownValue(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

// Texto acotado a MAX_TEXT_LENGTH. `null` si no hay valor o si no se puede convertir a texto.
// Todas las cotas de texto del registro pasan por aquí.
function boundText(value) {
    if (value === undefined || value === null) {
        return null;
    }
    try {
        return String(value).slice(0, MAX_TEXT_LENGTH);
    } catch (_e) {
        return null;
    }
}

// Texto acotado que sí trae contenido (no vacío ni solo espacios); si no, `null`.
function presentText(value) {
    const text = boundText(value);
    return text !== null && text.trim() !== '' ? text : null;
}

// Mensaje acotado de un error o de un valor de error; nunca lanza y nunca queda vacío.
function errorText(err) {
    try {
        const text = boundText(err && typeof err.message === 'string' ? err.message : err);
        return text ? text : 'error sin descripción';
    } catch (_e) {
        return 'error sin descripción';
    }
}

// Llave de un pago: el DOCNBR como texto sin espacios a las orillas. Se descarta si no es texto,
// si queda vacío o si es '__proto__', que al asignarse cambiaría el prototipo de `payments`.
function ledgerKey(rawKey) {
    if (typeof rawKey !== 'string') {
        return null;
    }
    const key = boundText(rawKey.trim());
    if (key === null || key === '' || key === '__proto__') {
        return null;
    }
    return key;
}

// Pares [DOCNBR, resultado] de un Map o de un arreglo de pares. Cualquier otro tipo es un error
// de programación de quien llama: lanza, y recordPaymentRun lo vuelve { ok: false }.
function resultEntries(results) {
    if (results instanceof Map) {
        return Array.from(results.entries());
    }
    if (Array.isArray(results)) {
        return results.filter((pair) => Array.isArray(pair));
    }
    throw new TypeError('mergePaymentRun: results debe ser un Map o un arreglo de pares');
}

// Hasta MAX_INVOICES facturas, solo las que traen texto y cada una acotada.
function boundInvoices(list) {
    const out = [];
    for (const item of list) {
        if (out.length >= MAX_INVOICES) {
            break;
        }
        const text = presentText(item);
        if (text !== null) {
            out.push(text);
        }
    }
    return out;
}

// Entrada de un pago después de esta corrida (D-16). Gana el último resultado: `outcome`, `code`
// y `description` salen del resultado nuevo. `attempts` suma 1 a lo anterior (uno por corrida que
// vio el pago) y `firstAt` se conserva. `vendor` y `fechaRegistro` se conservan si el resultado
// nuevo no los trae o los trae sin forma válida, porque son datos del pago y no del intento.
// `invoices` solo va si el resultado nuevo las trae.
function buildPaymentEntry(previous, result, runAt) {
    const prev = isPlainObject(previous) ? previous : {};
    const prevAttempts = isCount(prev.attempts) ? prev.attempts : 0;
    let fechaRegistro = null;
    if (isDateText(result.fechaRegistro)) {
        fechaRegistro = result.fechaRegistro;
    } else if (isDateText(prev.fechaRegistro)) {
        fechaRegistro = prev.fechaRegistro;
    }
    const entry = {
        outcome: result.outcome,
        code: boundText(result.code),
        description: boundText(result.description),
        vendor: presentText(result.vendor) ?? presentText(prev.vendor),
        fechaRegistro,
        attempts: prevAttempts + 1,
        firstAt: isStampText(prev.firstAt) ? prev.firstAt : runAt,
        lastAt: runAt,
    };
    if (Array.isArray(result.invoices)) {
        entry.invoices = boundInvoices(result.invoices);
    }
    return entry;
}

// Motivo por el que un JSON no es un registro válido de ese día, o `null` si lo es.
function shapeProblem(data, dateISO) {
    if (!isPlainObject(data)) {
        return 'la raíz no es un objeto';
    }
    if (data.version !== LEDGER_VERSION) {
        return `version distinta de ${LEDGER_VERSION}`;
    }
    if (!isDateText(data.date) || data.date !== dateISO) {
        return 'date no coincide con el día del archivo';
    }
    if (!isPlainObject(data.tenants)) {
        return 'tenants no es un objeto';
    }
    if (data.recoveredAt !== undefined && !isStampText(data.recoveredAt)) {
        return 'recoveredAt sin la forma YYYY-MM-DDTHH:MM:SS';
    }
    return null;
}

/**
 * Ruta del registro del día: `<logsRoot>/sageconnect/<dateISO>/daily-summary-payments.json`, en
 * la misma carpeta del día que usa LogGenerator (D-16).
 *
 * @param {string} logsRoot - Raíz de bitácoras (`config.paths.logs`); la lee quien llama.
 * @param {string} dateISO - Día `YYYY-MM-DD` en TIMEZONE.
 * @returns {string}
 * @throws {TypeError} Si `logsRoot` no es texto no vacío o si `dateISO` no casa con
 *   `^\d{4}-\d{2}-\d{2}$`: la fecha entra en una ruta y no puede traer `..` ni separadores
 *   (T-20.7-12).
 */
function ledgerFilePath(logsRoot, dateISO) {
    if (typeof logsRoot !== 'string' || logsRoot.trim() === '') {
        throw new TypeError('ledgerFilePath: logsRoot debe ser texto no vacío');
    }
    if (!isDateText(dateISO)) {
        throw new TypeError('ledgerFilePath: dateISO debe tener la forma YYYY-MM-DD');
    }
    return path.join(logsRoot, 'sageconnect', dateISO, LEDGER_FILE_NAME);
}

/**
 * Lee el registro del día. Nunca lanza y distingue tres casos (D-19):
 * - `{ status: 'missing', data: null }`: el archivo no existe;
 * - `{ status: 'ok', data }`: JSON con `version === 1`, `date === dateISO`, `tenants` objeto y
 *   `recoveredAt` ausente o con la forma `YYYY-MM-DDTHH:MM:SS`;
 * - `{ status: 'corrupt', data: null, error }`: cualquier otro caso, incluidos una fecha distinta
 *   a la del archivo y una carpeta en lugar del archivo.
 *
 * @param {string} filePath - La ruta que da ledgerFilePath.
 * @param {string} dateISO - El día que debe traer el archivo.
 * @returns {{status: 'missing'|'ok'|'corrupt', data: object|null, error?: string}}
 */
function readPaymentDayLedger(filePath, dateISO) {
    // Solo una ruta de texto: la lectura también acepta un descriptor numérico y leería otra cosa.
    if (typeof filePath !== 'string' || filePath === '') {
        return { status: 'corrupt', data: null, error: 'la ruta del registro no es texto' };
    }
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
            return { status: 'missing', data: null };
        }
        return { status: 'corrupt', data: null, error: errorText(err) };
    }
    let data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        return { status: 'corrupt', data: null, error: `JSON inválido: ${errorText(err)}` };
    }
    const problem = shapeProblem(data, dateISO);
    if (problem !== null) {
        return { status: 'corrupt', data: null, error: problem };
    }
    return { status: 'ok', data };
}

/**
 * Registro vacío de un día, un objeto nuevo en cada llamada.
 *
 * @param {string} dateISO
 * @returns {{version: number, date: string, tenants: object}}
 */
function emptyPaymentDayLedger(dateISO) {
    return { version: LEDGER_VERSION, date: dateISO, tenants: {} };
}

/**
 * Mezcla la corrida de una empresa en el registro del día. Devuelve un objeto NUEVO y no muta
 * `data`: conserva los campos de la raíz, incluido `recoveredAt`, y las demás empresas tal cual.
 *
 * Empresa: `{ runs, lastRunAt, queryFailures, lastQueryError, payments }`. `runs` suma 1 y
 * `lastRunAt = runAt` en cada llamada, aunque `results` venga vacío (D-18: un archivo ausente
 * quiere decir que ese día no corrió la subida de pagos). Un `queryError` presente suma 1 a
 * `queryFailures` y queda en `lastQueryError`, para que el resumen no confunda una consulta
 * fallida con un día sin pendientes (D-27).
 *
 * Pago: `{ outcome, code, description, vendor, fechaRegistro, attempts, firstAt, lastAt,
 * invoices? }` (buildPaymentEntry). Un resultado con `outcome` fuera de LEDGER_OUTCOMES o con un
 * DOCNBR vacío se ignora. Textos a 500 caracteres y facturas a 50 por pago (RD-10).
 *
 * @param {object} data - Registro del día, legible o vacío.
 * @param {{tenantDb: string, runAt: string, results: (Map|Array), queryError: *}} run - `results`
 *   es un Map (o un arreglo de pares) DOCNBR → `{ outcome, code?, description?, vendor?,
 *   fechaRegistro?, invoices? }`; `runAt` es `YYYY-MM-DDTHH:MM:SS`.
 * @returns {object}
 * @throws {TypeError} Si `data`, `tenantDb`, `runAt` o `results` no tienen la forma esperada.
 */
function mergePaymentRun(data, run) {
    if (!isPlainObject(data)) {
        throw new TypeError('mergePaymentRun: data debe ser un objeto');
    }
    const { tenantDb, runAt, results, queryError } = isPlainObject(run) ? run : {};
    if (typeof tenantDb !== 'string' || tenantDb.trim() === '' || tenantDb === '__proto__') {
        throw new TypeError('mergePaymentRun: tenantDb debe ser texto no vacío');
    }
    if (!isStampText(runAt)) {
        throw new TypeError('mergePaymentRun: runAt debe tener la forma YYYY-MM-DDTHH:MM:SS');
    }
    const entries = resultEntries(results);

    const prevTenants = isPlainObject(data.tenants) ? data.tenants : {};
    const prevTenantValue = ownValue(prevTenants, tenantDb);
    const prevTenant = isPlainObject(prevTenantValue) ? prevTenantValue : {};
    const prevPayments = isPlainObject(prevTenant.payments) ? prevTenant.payments : {};

    // Cada pago se compara contra el archivo de ANTES de esta corrida, así un DOCNBR repetido
    // dentro de la misma corrida suma un solo intento.
    const payments = { ...prevPayments };
    for (const [rawKey, result] of entries) {
        const docnbr = ledgerKey(rawKey);
        if (docnbr === null || !isPlainObject(result) || !LEDGER_OUTCOMES.includes(result.outcome)) {
            continue;
        }
        payments[docnbr] = buildPaymentEntry(ownValue(prevPayments, docnbr), result, runAt);
    }

    const failed = queryError !== undefined && queryError !== null;
    const prevFailures = isCount(prevTenant.queryFailures) ? prevTenant.queryFailures : 0;
    const tenantEntry = {
        runs: (isCount(prevTenant.runs) ? prevTenant.runs : 0) + 1,
        lastRunAt: runAt,
        queryFailures: failed ? prevFailures + 1 : prevFailures,
        lastQueryError: failed ? errorText(queryError) : presentText(prevTenant.lastQueryError),
        payments,
    };

    return { ...data, tenants: { ...prevTenants, [tenantDb]: tenantEntry } };
}

/**
 * Vuelca la corrida de una empresa en el registro del día. Síncrona y NUNCA lanza (D-18).
 *
 * Lee el archivo. Si está legible lo usa; si falta arranca uno vacío; si está dañado (existía y no
 * se pudo parsear o no tenía la forma esperada) arranca uno vacío con `recoveredAt = runAt` en la
 * RAÍZ y devuelve `recovered: true`, para que quien llama deje su aviso (D-19). Una corrida normal
 * posterior conserva ese `recoveredAt`, y un segundo daño lo reemplaza por la hora del último
 * reinicio. Mezcla con mergePaymentRun y escribe con writeSentinelAtomically (el temporal y luego
 * el rename): si algo falla, el archivo anterior queda intacto.
 *
 * @param {{logsRoot: string, dateISO: string, tenantDb: string, runAt: string, results: (Map|Array), queryError: *}} args
 *   `runAt` es la hora de pared en TIMEZONE (`YYYY-MM-DDTHH:MM:SS`) de la misma lectura del reloj
 *   que dio `dateISO`; la toma quien llama, una vez por corrida.
 * @returns {{ok: boolean, previous: ('missing'|'ok'|'corrupt'|null), recovered: boolean, file: (string|null), error: (string|null)}}
 *   `previous` es lo que se encontró en disco (`null` si no se llegó a leer); `recovered` solo es
 *   `true` si el archivo dañado sí quedó reiniciado.
 */
function recordPaymentRun(args) {
    let file = null;
    let previous = null;
    try {
        const { logsRoot, dateISO, tenantDb, runAt, results, queryError } = isPlainObject(args) ? args : {};
        file = ledgerFilePath(logsRoot, dateISO);
        const current = readPaymentDayLedger(file, dateISO);
        previous = current.status;
        let base;
        let recovered = false;
        if (current.status === 'ok') {
            base = current.data;
        } else if (current.status === 'corrupt') {
            const fresh = emptyPaymentDayLedger(dateISO);
            base = { version: fresh.version, date: fresh.date, recoveredAt: runAt, tenants: fresh.tenants };
            recovered = true;
        } else {
            base = emptyPaymentDayLedger(dateISO);
        }
        const next = mergePaymentRun(base, { tenantDb, runAt, results, queryError });
        writeSentinelAtomically(file, next);
        return { ok: true, previous, recovered, file, error: null };
    } catch (err) {
        return { ok: false, previous, recovered: false, file, error: errorText(err) };
    }
}

module.exports = {
    LEDGER_FILE_NAME,
    LEDGER_OUTCOMES,
    ledgerFilePath,
    readPaymentDayLedger,
    emptyPaymentDayLedger,
    mergePaymentRun,
    recordPaymentRun,
};
