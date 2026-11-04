// Fase 20.7 (D-01): recolección del resumen diario de reintentos sin éxito. Lee lo que pasó en el
// día resumido (de SQL Server, las OCs con error y las OCs subidas; del registro diario de pagos,
// el último resultado de cada pago) y arma con eso el modelo del correo con
// buildDailySummaryModel. El plan 20.7-07 agrega en este mismo archivo el despacho: el estado del
// día, el intento y el envío.
//
// La cabecera no carga el envío de correo: la vista previa (D-36) usa collectDailySummary y no
// debe cargar EmailSender ni la librería de correo con solo requerir este módulo. El despacho lo
// cargará dentro de su propio camino de envío.
//
// No guarda estado de módulo: a nivel de módulo solo hay constantes (CLAUDE.md §3), y la config
// llega por parámetro.
//
// Solo lee. Las tres consultas son SELECT, y a su texto entran únicamente la fecha resumida, ya
// validada como fecha real YYYY-MM-DD, y los nombres de base de la configuración, que además
// deben casar con TENANT_DB_PATTERN (CLAUDE.md §6 #1). Cada consulta va a la base de su empresa,
// pasada de forma explícita (CLAUDE.md §6 #2). Ninguna reusa el filtro de ventana del ciclo, que
// se ancla en el reloj de SQL Server: la ventana la aplica el modelo contra el día resumido
// (D-15, D-42).
//
// La consulta de OCs y la de la tabla de control de pagos están separadas a propósito, una al
// principio y otra al final del archivo: la de OCs lee la columna del último error, que la tabla
// de pagos no tiene, y tests/schema-guard.test.js prohíbe esa columna a 12 renglones o menos de
// cualquier mención de la tabla de pagos (D-42).

const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { ledgerFilePath, readPaymentDayLedger } = require('../utils/PaymentDayLedger');
const { isIsoDate, sanitizeLogText, buildDailySummaryModel } = require('../utils/DailySummary');

const LOG_FILE = 'EomNotification';

// Lo único que puede ser un nombre de base dentro del texto del SQL: letras, dígitos, guion bajo
// y guion (CLAUDE.md §6 #1). Sin la bandera g, test() no guarda estado entre llamadas.
const TENANT_DB_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Consulta de las OCs con error del día resumido en una empresa (RD-05, D-11). Parte de las filas
 * ERROR creadas ese día, que son pocas, y no del catálogo de OCs de Sage:
 * - `E` agrupa esas filas por OC; de ahí salen los intentos del día;
 * - `L` toma UNA fila ERROR del día de esa OC, y de esa misma fila salen el último error y la
 *   marca de validación (el sitio de Joi inserta idFocaltec vacío; el del POST, NULL). La tabla
 *   no guarda hora, así que cualquier fila del día sirve; el ORDER BY solo la vuelve determinista;
 * - `A` toma la autorización como la fecha más reciente del detalle de autorizaciones;
 * - solo quedan OCs autorizadas y sin fila POSTED ni CLOSED, el mismo filtro de repetidas que usa
 *   el ciclo de subida de OCs.
 *
 * Las fechas salen como texto YYYY-MM-DD (CONVERT estilo 23), para que tedious no las corra un
 * día con useUTC. La ventana de reintentos no va aquí: la aplica el modelo contra el día resumido.
 *
 * Precondición: `tenantDb` casa con TENANT_DB_PATTERN y `dateISO` pasa isIsoDate.
 * collectDailySummary lo comprueba antes de llamar; esta función solo arma el texto.
 *
 * @param {string} tenantDb - Base de la empresa (`cfg.portal.tenants[i].database`).
 * @param {string} dateISO - Día resumido, `YYYY-MM-DD`.
 * @returns {string}
 */
function buildOcDayQuery(tenantDb, dateISO) {
    return `
        SELECT
            '${tenantDb}' AS tenant,
            RTRIM(E.ocSage) AS idOrPo,
            E.attemptsToday,
            L.lastError,
            CASE WHEN L.idFocaltec = '' THEN 1 ELSE 0 END AS isValidation,
            CONVERT(VARCHAR(10), A.fechaAuthRaw, 23) AS fechaAuth
        FROM (
            SELECT ocSage, COUNT(*) AS attemptsToday
            FROM fesa.dbo.fesaOCFocaltec
            WHERE status = 'ERROR'
              AND idDatabase = '${tenantDb}'
              AND createdAt = CAST('${dateISO}' AS DATE)
            GROUP BY ocSage
        ) AS E
        CROSS APPLY (
            SELECT TOP 1 R.responseAPI AS lastError, R.idFocaltec
            FROM fesa.dbo.fesaOCFocaltec R
            WHERE R.ocSage = E.ocSage
              AND R.idDatabase = '${tenantDb}'
              AND R.status = 'ERROR'
              AND R.createdAt = CAST('${dateISO}' AS DATE)
            ORDER BY R.responseAPI DESC
        ) AS L
        OUTER APPLY (
            SELECT MAX(D.Fecha) AS fechaAuthRaw
            FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle D
            WHERE D.Empresa = '${tenantDb}'
              AND D.PONumber = E.ocSage
        ) AS A
        WHERE EXISTS (
            SELECT 1 FROM Autorizaciones_electronicas.dbo.Autoriza_OC X
            WHERE X.PONumber = E.ocSage
              AND X.Empresa = '${tenantDb}'
              AND X.Autorizada = 1
        )
          AND NOT EXISTS (
            SELECT 1 FROM fesa.dbo.fesaOCFocaltec P
            WHERE P.ocSage = E.ocSage
              AND P.idDatabase = '${tenantDb}'
              AND P.status IN ('CLOSED', 'POSTED')
        )
    `;
}

/**
 * Consulta de las OCs subidas el día resumido en una empresa (RD-04, D-12): OCs distintas con
 * fila POSTED creada ese día, incluidas las que subió po-upload.js. En el mismo renglón devuelve
 * el reloj de SQL Server (su fecha, su hora y su desfase con UTC en minutos) para comparar
 * relojes (D-35). Un agregado sin GROUP BY siempre devuelve un renglón, así que el reloj llega
 * aunque ese día no se haya subido ninguna OC.
 *
 * Precondición: la misma de buildOcDayQuery.
 *
 * @param {string} tenantDb
 * @param {string} dateISO
 * @returns {string}
 */
function buildOcUploadedQuery(tenantDb, dateISO) {
    return `
        SELECT
            COUNT(DISTINCT ocSage) AS uploaded,
            CONVERT(VARCHAR(10), GETDATE(), 23) AS sqlDate,
            CONVERT(VARCHAR(19), GETDATE(), 120) AS sqlNow,
            DATEDIFF(minute, GETUTCDATE(), GETDATE()) AS sqlOffsetMin
        FROM fesa.dbo.fesaOCFocaltec
        WHERE status = 'POSTED'
          AND idDatabase = '${tenantDb}'
          AND createdAt = CAST('${dateISO}' AS DATE)
    `;
}

// Los renglones de un resultado de la consulta. Un resultado sin arreglo de renglones es una
// falla de esa fuente y no un día vacío: así el correo lo dice en una nota en vez de contar cero.
function recordsetOf(result) {
    if (!result || !Array.isArray(result.recordset)) {
        throw new Error('la consulta no devolvió renglones');
    }
    return result.recordset;
}

// El mensaje de una falla en un renglón y acotado; el mismo texto va a la bitácora y a la nota.
function failureText(err) {
    const raw = (err !== null && typeof err === 'object' && 'message' in err) ? err.message : err;
    return sanitizeLogText(raw, 200);
}

// D-27: una fuente que falla queda en el modelo, que la vuelve una nota del correo, y en la
// bitácora; la recolección sigue con la fuente y la empresa siguientes.
function recordSourceFailure(sourceFailures, dateISO, tenantDb, source, err) {
    const error = failureText(err);
    sourceFailures.push({ tenant: tenantDb, source, error });
    logGenerator(LOG_FILE, 'warn',
        `[DAILY-SUMMARY] date=${dateISO} tenant=${tenantDb} source=${source} status=query-failed err=${error}`);
}

// D-14: los NoPagoSage de la tabla de control, recortados (la columna es char y llega con
// relleno) y sin vacíos.
function controlDocNumbers(rows) {
    const out = [];
    for (const row of rows) {
        const docnbr = (row && row.NoPagoSage != null) ? String(row.NoPagoSage).trim() : '';
        if (docnbr !== '') {
            out.push(docnbr);
        }
    }
    return out;
}

/**
 * Recolecta el día resumido y devuelve el modelo del correo (RD-04 a RD-07 y RD-09; D-11, D-12,
 * D-14, D-19, D-27 y D-35).
 *
 * Por cada empresa, en el orden de la configuración, corre tres consultas independientes: las OCs
 * con error del día, las OCs subidas del día (con el reloj de SQL Server) y la tabla de control
 * de pagos. Una que falla no detiene a las demás ni a las otras empresas: queda en
 * `sourceFailures`, que el modelo vuelve una nota del correo, y deja un warn (D-27). Una empresa
 * cuyo nombre de base no es válido no se consulta y su nota lo dice. Después lee el registro
 * diario de pagos; si falta o no se puede leer, deja un warn y el correo lo dice (D-19).
 *
 * No escribe nada, ni en SQL ni en disco.
 *
 * @param {string} dateISO - Día resumido, `YYYY-MM-DD`.
 * @param {object} cfg - La config: usa `portal.tenants`, `paths.logs` y `retry`.
 * @returns {Promise<object>} El valor de buildDailySummaryModel.
 * @throws {Error} Si `dateISO` no es una fecha real `YYYY-MM-DD`. Lo comprueba antes de
 *   cualquier consulta, porque la fecha entra al texto del SQL (T-20.7-26).
 */
async function collectDailySummary(dateISO, cfg) {
    if (!isIsoDate(dateISO)) {
        throw new Error('collectDailySummary: fecha inválida');
    }

    const tenants = [];
    const ocRows = [];
    const ocUploadedByTenant = Object.create(null);
    const controlByTenant = Object.create(null);
    const sourceFailures = [];
    let clock = null;

    for (const entry of cfg.portal.tenants) {
        const tenantDb = (entry !== null && typeof entry === 'object') ? entry.database : undefined;
        tenants.push(tenantDb);
        // typeof va antes del patrón: test() convierte undefined o null en un texto que sí casa.
        if (typeof tenantDb !== 'string' || !TENANT_DB_PATTERN.test(tenantDb)) {
            sourceFailures.push({
                tenant: (typeof tenantDb === 'string' && tenantDb !== '') ? tenantDb : null,
                source: 'oc-errors',
                error: 'nombre de base no válido',
            });
            logGenerator(LOG_FILE, 'warn',
                `[DAILY-SUMMARY] date=${dateISO} tenant=${sanitizeLogText(tenantDb, 100)} source=oc-errors status=invalid-db-name`);
            continue;
        }

        try {
            const rows = recordsetOf(await runQuery(buildOcDayQuery(tenantDb, dateISO), tenantDb));
            for (const row of rows) {
                ocRows.push(row);
            }
        } catch (err) {
            recordSourceFailure(sourceFailures, dateISO, tenantDb, 'oc-errors', err);
        }

        try {
            const rows = recordsetOf(await runQuery(buildOcUploadedQuery(tenantDb, dateISO), tenantDb));
            const first = rows.length > 0 ? rows[0] : {};
            ocUploadedByTenant[tenantDb] = Number(first.uploaded) || 0;
            if (clock === null && rows.length > 0) {
                clock = { sqlDate: first.sqlDate, sqlNow: first.sqlNow, sqlOffsetMin: first.sqlOffsetMin };
            }
        } catch (err) {
            recordSourceFailure(sourceFailures, dateISO, tenantDb, 'oc-uploaded', err);
        }

        try {
            const rows = recordsetOf(await runQuery(buildPaymentsControlQuery(tenantDb), tenantDb));
            controlByTenant[tenantDb] = controlDocNumbers(rows);
        } catch (err) {
            recordSourceFailure(sourceFailures, dateISO, tenantDb, 'payments-control', err);
        }
    }

    // D-19: el registro va al modelo tal como lo devolvió la lectura, sin copiar ni quitar campos;
    // un reinicio trae recoveredAt en la raíz y el modelo arma con él la nota. Si la ruta no se
    // puede armar, el registro cuenta como ilegible.
    let ledger;
    try {
        ledger = readPaymentDayLedger(ledgerFilePath(cfg.paths.logs, dateISO), dateISO);
    } catch (err) {
        ledger = { status: 'corrupt', data: null, error: failureText(err) };
    }
    if (ledger.status === 'missing') {
        logGenerator(LOG_FILE, 'warn', `[DAILY-SUMMARY-LEDGER] date=${dateISO} status=missing`);
    } else if (ledger.status === 'corrupt') {
        logGenerator(LOG_FILE, 'warn',
            `[DAILY-SUMMARY-LEDGER] date=${dateISO} status=unreadable err=${sanitizeLogText(ledger.error)}`);
    }

    return buildDailySummaryModel({
        dateISO,
        retry: cfg.retry,
        tenants,
        ocRows,
        ocUploadedByTenant,
        ledger,
        controlByTenant,
        sourceFailures,
        clock,
    });
}

/**
 * Consulta de la tabla de control de pagos de una empresa (D-14): el conjunto completo de sus
 * NoPagoSage, de cualquier estado. Un pago con fila ahí ya no está pendiente aunque su último
 * resultado en el registro del día haya sido un fallo. Lee la empresa entera, como ya lo hace el
 * controlador de pagos en cada corrida, para no interpolar listas de documentos en el SQL.
 *
 * Vive al final del archivo, lejos de la consulta de OCs (D-42, M-6): la tabla de pagos solo tiene
 * idCia, NoPagoSage, status e idFocaltec, y tests/schema-guard.test.js no deja que las columnas
 * propias de la tabla de OCs aparezcan a 12 renglones o menos de esta.
 *
 * Precondición: `tenantDb` casa con TENANT_DB_PATTERN; collectDailySummary lo comprueba.
 *
 * @param {string} tenantDb
 * @returns {string}
 */
function buildPaymentsControlQuery(tenantDb) {
    return `
        SELECT RTRIM(NoPagoSage) AS NoPagoSage
        FROM fesa.dbo.fesaPagosFocaltec
        WHERE idCia = '${tenantDb}'
    `;
}

module.exports = { buildOcDayQuery, buildOcUploadedQuery, buildPaymentsControlQuery, collectDailySummary };
