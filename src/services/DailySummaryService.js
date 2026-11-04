// Fase 20.7 (D-01): recolección y despacho del resumen diario de reintentos sin éxito.
// - La recolección lee lo que pasó en el día resumido (de SQL Server, las OCs con error y las OCs
//   subidas; del registro diario de pagos, el último resultado de cada pago) y arma con eso el
//   modelo del correo con buildDailySummaryModel.
// - El despacho (plan 20.7-07) lleva el estado de cada día resumido en disco, anota cada intento
//   antes de enviar y manda el correo por el canal del operador. Qué toca en cada ejecución lo
//   decide decideDailySummaryAction; aquí solo se lee, se escribe y se envía.
//
// La cabecera no carga el envío de correo: la vista previa (D-36) usa collectDailySummary y no
// debe cargar EmailSender ni la librería de correo con solo requerir este módulo. El despacho lo
// carga dentro de su propio camino de envío, solo cuando hay un intento que hacer.
//
// No guarda estado de módulo: a nivel de módulo solo hay constantes (CLAUDE.md §3), y la config
// llega por parámetro. El despacho no usa temporizadores: la espera entre dos intentos se mide
// contra el estado en disco en una ejecución posterior. Toda marca de tiempo sale del reloj que
// recibe el despacho, nunca de un segundo reloj (D-42).
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

const fs = require('fs');
const path = require('path');
const { runQuery } = require('../utils/SQLServerConnection');
const { logGenerator } = require('../utils/LogGenerator');
const { writeSentinelAtomically } = require('../utils/EomNotification');
const { ledgerFilePath, readPaymentDayLedger } = require('../utils/PaymentDayLedger');
const {
    MAX_ATTEMPTS,
    localDateISO,
    localStamp,
    addDaysISO,
    isIsoDate,
    isValidDayState,
    decideDailySummaryAction,
    sanitizeLogText,
    buildDailySummaryModel,
    buildDailySummaryHtml,
    buildDailySummarySubject,
    formatAttemptLogLine,
    formatAbandonLogLine,
    formatClockWarnLine,
} = require('../utils/DailySummary');

const LOG_FILE = 'EomNotification';

// D-04: el estado de cada día resumido vive en la carpeta de ese día, junto a sus bitácoras.
const STATE_FILE_NAME = 'daily-summary.json';

// T-20.7-36: el mensaje del transporte se guarda en el estado recortado a 500 caracteres; en la
// bitácora va saneado y acotado a 200 por formatAttemptLogLine.
const STATE_ERROR_MAX = 500;

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
    // puede armar, el registro cuenta como ilegible. Ilegible por E/S (WR-02) o dañado, el correo
    // dice lo mismo: que el registro de pagos no se pudo leer.
    let ledger;
    try {
        ledger = readPaymentDayLedger(ledgerFilePath(cfg.paths.logs, dateISO), dateISO);
    } catch (err) {
        ledger = { status: 'unreadable', data: null, error: failureText(err) };
    }
    if (ledger.status === 'missing') {
        logGenerator(LOG_FILE, 'warn', `[DAILY-SUMMARY-LEDGER] date=${dateISO} status=missing`);
    } else if (ledger.status === 'corrupt' || ledger.status === 'unreadable') {
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
 * Ruta del estado de un día resumido (D-04): `<logsRoot>/sageconnect/<dateISO>/daily-summary.json`,
 * en la misma carpeta del día que usan las bitácoras y el registro de pagos. LogDashboardService
 * solo lista carpetas de fecha y solo abre bitácoras .log, así que este archivo no le estorba.
 *
 * @param {string} logsRoot - Raíz de bitácoras (`config.paths.logs`); la lee quien llama.
 * @param {string} dateISO - Día resumido, `YYYY-MM-DD`.
 * @returns {string}
 * @throws {TypeError} Si `logsRoot` no es texto no vacío o si `dateISO` no es una fecha real
 *   `YYYY-MM-DD`: la fecha entra en una ruta y no puede traer `..` ni separadores.
 */
function dayStatePath(logsRoot, dateISO) {
    if (typeof logsRoot !== 'string' || logsRoot.trim() === '') {
        throw new TypeError('dayStatePath: logsRoot debe ser texto no vacío');
    }
    if (!isIsoDate(dateISO)) {
        throw new TypeError('dayStatePath: dateISO debe ser una fecha YYYY-MM-DD válida');
    }
    return path.join(logsRoot, 'sageconnect', dateISO, STATE_FILE_NAME);
}

/**
 * Lee el estado de un día resumido. Nunca lanza y distingue cuatro casos:
 * - `{ status: 'missing' }`: el archivo no existe. Un día sin estado no debe su resumen (D-05);
 * - `{ status: 'ok', data }`: JSON que pasa isValidDayState para esa fecha;
 * - `{ status: 'unreadable', error }`: no se pudo leer, por un error de E/S distinto de ENOENT
 *   (EACCES, EPERM, EBUSY, EMFILE, EIO, una carpeta en su lugar) o porque no se pudo armar la
 *   ruta. No dice nada del contenido (WR-01);
 * - `{ status: 'corrupt' }`: se leyó y el contenido no sirve: un JSON que no se puede leer, el
 *   estado de otra fecha o una forma que no se reconoce.
 *
 * Un estado dañado no cuenta como ausente: si contara, el día se volvería a crear pendiente y
 * podría reenviarse un resumen que ya salió. La agenda lo abandona con state-corrupt, sin enviar
 * (T-20.7-33). Uno ilegible tampoco cuenta como dañado: abandonarlo lo perdería para siempre por
 * una falla que suele ser pasajera, y reescribirlo borraría sus intentos. La agenda no lo toca y
 * la ejecución siguiente lo vuelve a leer.
 *
 * @param {string} logsRoot - Raíz de bitácoras.
 * @param {string} dateISO - Día resumido, `YYYY-MM-DD`.
 * @returns {{status: string, data?: object, error?: string}}
 */
function readDayState(logsRoot, dateISO) {
    let raw;
    try {
        raw = fs.readFileSync(dayStatePath(logsRoot, dateISO), 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return { status: 'missing' };
        }
        return { status: 'unreadable', error: failureText(err) };
    }
    try {
        const data = JSON.parse(raw);
        return isValidDayState(data, dateISO) ? { status: 'ok', data } : { status: 'corrupt' };
    } catch (_err) {
        return { status: 'corrupt' };
    }
}

// El estado de un día con la forma de D-04 y sus llaves en ese orden: date, status, attempts y,
// solo en un día abandonado, reason. Cada intento se copia con sus tres campos, así nada más de lo
// que traía el archivo leído pasa al que se escribe.
function dayState(dateISO, status, attempts, reason) {
    const state = {
        date: dateISO,
        status,
        attempts: attempts.map((attempt) => ({
            at: attempt.at,
            delivered: attempt.delivered,
            error: attempt.error ?? null,
        })),
    };
    if (reason !== undefined) {
        state.reason = reason;
    }
    return state;
}

// Escribe el estado de un día con la escritura atómica de los centinelas (D-04): un temporal y
// luego renombrar, así una caída a media escritura no deja un archivo a medias. Devuelve null si
// quedó escrito o, si no, el texto del error listo para la bitácora; nunca lanza.
function writeDayState(logsRoot, state) {
    try {
        writeSentinelAtomically(dayStatePath(logsRoot, state.date), state);
        return null;
    } catch (err) {
        return failureText(err);
    }
}

/**
 * Despacho del resumen diario (RD-01, RD-02, RD-03 y RD-09; D-04 a D-08, D-34, D-35, D-40 y
 * D-42). forResponse lo llama una vez por ejecución, al terminar el recorrido de empresas, con el
 * `date` de esa ejecución; el bloque que lo llama le pone su propio límite de tiempo.
 *
 * 1. Apagado (sin la llave del resumen, o con `enabled` distinto de `true`): sale sin leer, sin
 *    escribir y sin dejar bitácora (D-06 paso 1, D-34, D-40).
 * 2. Lee el estado de hoy y el de ayer y aplica, en orden, las operaciones de
 *    decideDailySummaryAction:
 *    - crear: el día queda pendiente y sin intentos (D-05);
 *    - abandonar: el día queda abandonado con su motivo, y una línea de abandono lo anuncia;
 *    - intentar: los pasos 3 a 5.
 *    Cada escritura va en su propio try/catch. Un día cuya creación no se pudo escribir no se
 *    intenta en esta ejecución. Un día cuyo estado no se pudo leer (error de E/S) no recibe
 *    operaciones ni se reescribe: solo deja una línea warn state-unreadable (WR-01).
 * 3. El intento se anota en disco con `delivered: null` ANTES de recolectar y de enviar, y si
 *    esa escritura falla, en esta ejecución no se envía (D-08). Como queda anotado antes de
 *    recolectar, ni la continuación de un bloque que se pasó de tiempo ni una ejecución manual
 *    que empiece mientras esta recolecta pueden mandar otra copia: para ellas el intento ya
 *    existe y su espera ya corre.
 * 4. Recolecta el día, arma el correo con el tope de renglones y lo manda por el canal del
 *    operador (MAILING_NOTICES con copia a MAILING_CC), nunca por el buzón de administración.
 *    Solo un desenlace con `delivered === true` cuenta como entregado; uno ausente o con otra
 *    forma es un envío que no consta (S-2).
 * 5. Completa el intento y el estado: entregado; abandonado con max-attempts si era el último
 *    intento (D-07); o pendiente, para que lo retome una ejecución posterior. Si esta escritura
 *    falla, el intento se queda en `null` y cuenta como fallido (D-08). Cada intento deja una
 *    sola línea, en warn si no se entregó (D-34).
 *
 * Al resumir hoy, si la fecha de SQL Server no es la de hoy, deja un warn de reloj (D-35). En una
 * reposición no, porque ahí la fecha de SQL Server ya es la del día siguiente.
 *
 * Nunca lanza (RD-03): una excepción de cualquier paso queda como una línea de error
 * dispatch-failed, y un intento ya anotado se queda en `null`.
 *
 * @param {Date} now - El `date` de forResponse; sus campos locales son la hora de TIMEZONE.
 * @param {object} cfg - La config: usa `notifications.dailySummary`, `paths.logs`,
 *   `portal.tenants` y `retry`.
 * @returns {Promise<void>}
 */
async function dispatchDailySummaryIfDue(now, cfg) {
    try {
        const summaryCfg = cfg?.notifications?.dailySummary;
        if (!summaryCfg || summaryCfg.enabled !== true) {
            return;
        }
        // Sin carpeta de bitácoras no hay dónde anotar el intento, y sin intento anotado no hay
        // envío (D-08).
        const logsRoot = cfg?.paths?.logs;
        if (typeof logsRoot !== 'string' || logsRoot.trim() === '') {
            logGenerator(LOG_FILE, 'error', '[DAILY-SUMMARY] status=no-log-path');
            return;
        }

        const todayISO = localDateISO(now);
        const yesterdayISO = addDaysISO(todayISO, -1);
        const today = readDayState(logsRoot, todayISO);
        const yesterday = readDayState(logsRoot, yesterdayISO);
        const decision = decideDailySummaryAction({ now, summaryCfg, today, yesterday });
        const { ops } = decision;

        // WR-01: un día cuyo estado no se pudo leer no recibe operaciones y su archivo no se toca;
        // solo queda esta línea, y la ejecución siguiente lo vuelve a leer. Una decisión cerrada
        // (todayISO null) no deja nada, como antes.
        if (decision.todayISO !== null) {
            for (const [dateISO, read] of [[todayISO, today], [yesterdayISO, yesterday]]) {
                if (read.status === 'unreadable') {
                    logGenerator(LOG_FILE, 'warn',
                        `[DAILY-SUMMARY] date=${dateISO} status=state-unreadable err=${read.error}`);
                }
            }
        }

        // Lo que hay en disco de cada día mientras se aplican las operaciones: el estado leído o
        // el que se acaba de escribir. Un día que no está aquí no tiene estado escrito y no se
        // intenta (D-08).
        const written = Object.create(null);
        if (today.status === 'ok') {
            written[todayISO] = today.data;
        }
        if (yesterday.status === 'ok') {
            written[yesterdayISO] = yesterday.data;
        }

        for (const op of ops) {
            if (op.type === 'create') {
                const created = dayState(op.date, 'pending', []);
                const createError = writeDayState(logsRoot, created);
                if (createError === null) {
                    written[op.date] = created;
                } else {
                    logGenerator(LOG_FILE, 'error',
                        `[DAILY-SUMMARY] date=${op.date} status=state-write-failed err=${createError}`);
                }
            } else if (op.type === 'abandon') {
                // Un día dañado no tiene intentos que conservar: se abandona con la lista vacía.
                const prior = written[op.date];
                const abandoned = dayState(op.date, 'abandoned', prior ? prior.attempts : [], op.reason);
                const abandonError = writeDayState(logsRoot, abandoned);
                if (abandonError === null) {
                    written[op.date] = abandoned;
                    logGenerator(LOG_FILE, 'warn',
                        formatAbandonLogLine({ dateISO: op.date, reason: op.reason, attempts: op.attempts }));
                } else {
                    logGenerator(LOG_FILE, 'error',
                        `[DAILY-SUMMARY] date=${op.date} status=state-write-failed err=${abandonError}`);
                }
            } else if (op.type === 'attempt' && written[op.date]) {
                const target = op.date;
                const attemptNumber = op.attemptNumber;
                const at = localStamp(now);

                // D-08: el intento queda anotado antes de recolectar y de enviar.
                const attempts = written[target].attempts.concat([{ at, delivered: null, error: null }]);
                const noteError = writeDayState(logsRoot, dayState(target, 'pending', attempts));
                if (noteError !== null) {
                    logGenerator(LOG_FILE, 'error',
                        `[DAILY-SUMMARY] date=${target} attempt=${attemptNumber}/${MAX_ATTEMPTS} sent=false status=state-write-failed err=${noteError}`);
                    continue;
                }

                const model = await collectDailySummary(target, cfg);

                if (target === todayISO && model.clock && model.clock.sqlDate && model.clock.sqlDate !== todayISO) {
                    logGenerator(LOG_FILE, 'warn', formatClockWarnLine(todayISO, model.clock.sqlDate));
                }

                const html = buildDailySummaryHtml(model, { cap: true });
                const subject = buildDailySummarySubject(model);

                // D-01: el envío se carga aquí, al intentar, y no en la cabecera del módulo.
                const { sendOperatorReport } = require('../utils/EmailSender');
                const delivery = await sendOperatorReport({ subject, html, callerLogFile: LOG_FILE });

                // S-2: lectura en cerrado del desenlace.
                let delivered = false;
                let error = null;
                if (delivery && delivery.delivered === true) {
                    delivered = true;
                } else {
                    const reported = (delivery && delivery.error) ? delivery.error : 'unknown delivery failure';
                    error = String(reported).slice(0, STATE_ERROR_MAX);
                }

                attempts[attempts.length - 1] = { at, delivered, error };
                let status = 'pending';
                let reason;
                if (delivered) {
                    status = 'delivered';
                } else if (attempts.length >= MAX_ATTEMPTS) {
                    status = 'abandoned';
                    reason = 'max-attempts';
                }
                const completeError = writeDayState(logsRoot, dayState(target, status, attempts, reason));
                if (completeError !== null) {
                    logGenerator(LOG_FILE, 'error',
                        `[DAILY-SUMMARY] date=${target} attempt=${attemptNumber}/${MAX_ATTEMPTS} sent=${delivered} status=state-write-failed-after-send err=${completeError}`);
                }

                logGenerator(LOG_FILE, delivered ? 'info' : 'warn', formatAttemptLogLine({
                    dateISO: target,
                    attemptNumber,
                    delivered,
                    counts: model.counts,
                    incomplete: model.incomplete,
                    error,
                }));
                // El abandono por tope solo se anuncia si quedó escrito. Si no, el día sigue
                // pendiente en disco con sus cuatro intentos, y la ejecución siguiente lo abandona
                // y lo anuncia: así queda una sola línea de abandono.
                if (status === 'abandoned' && completeError === null) {
                    logGenerator(LOG_FILE, 'warn',
                        formatAbandonLogLine({ dateISO: target, reason, attempts: attempts.length }));
                }
            }
        }
    } catch (err) {
        // RD-03: el despacho nunca lanza. La bitácora también puede lanzar; si lo hace, no queda a
        // quién avisar, y el error tampoco debe llegar al ciclo.
        try {
            logGenerator(LOG_FILE, 'error', `[DAILY-SUMMARY] status=dispatch-failed err=${failureText(err)}`);
        } catch (_logErr) {
            // Sin bitácora no hay nada más que hacer.
        }
    }
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

module.exports = {
    buildOcDayQuery,
    buildOcUploadedQuery,
    buildPaymentsControlQuery,
    collectDailySummary,
    dayStatePath,
    readDayState,
    dispatchDailySummaryIfDue,
};
