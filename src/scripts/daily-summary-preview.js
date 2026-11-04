/**
 * Daily Summary Preview (Fase 20.7; RD-13, RD-11, D-36)
 *
 * Arma el resumen diario de un día con la misma recolección y el mismo HTML del correo, pero sin
 * tope de renglones ni recorte de textos, y lo guarda en un archivo para abrirlo en el navegador.
 * Sirve para revisar el correo antes de encenderlo y para ver la lista completa que el correo
 * recorta a 100 renglones por sección. Funciona con el resumen apagado: el registro de pagos del
 * día se escribe siempre (D-20).
 *
 * Read-only: solo SELECT; no escribe el estado del día; no carga el envío de correo. Lo único que
 * escribe es el HTML de la vista previa.
 *
 * El sobre de [RESULT] trae el bloque clock, con el que se comprueban los relojes al instalar
 * (D-35): la fecha y la hora de TIMEZONE, cómo formatea este runtime la hora de medianoche
 * (midnightHourFormat) y la fecha, la hora y el desfase de SQL Server.
 *
 * Usage:
 *   node src/scripts/daily-summary-preview.js
 *   node src/scripts/daily-summary-preview.js --date 2026-11-03
 *   node src/scripts/daily-summary-preview.js --date 2026-11-03 --out <ruta>
 *
 * Args:
 *   --date YYYY-MM-DD  día resumido (opcional; por omisión, hoy en TIMEZONE)
 *   --out <ruta>       archivo de salida (opcional; por omisión,
 *                      <LOG_PATH>/sageconnect/<D>/daily-summary-preview.html)
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { logGenerator } = require('../utils/LogGenerator');
const { successResult, errorResult } = require('../utils/ResultEnvelope');
const { getCurrentDate, TIMEZONE } = require('../utils/TimezoneHelper');
const { closePool } = require('../utils/SQLServerConnection');
const { collectDailySummary } = require('../services/DailySummaryService');
const {
    buildDailySummaryHtml,
    buildDailySummarySubject,
    isIsoDate,
    localDateISO,
    localStamp,
} = require('../utils/DailySummary');

const LOG_FILE = 'DailySummaryPreview';

// D-36: nombre del archivo de la vista previa en la carpeta del día, junto al estado del día y al
// registro de pagos.
const PREVIEW_FILE_NAME = 'daily-summary-preview.html';

/**
 * Lee los argumentos de la línea de comandos: `--date <YYYY-MM-DD>` y `--out <ruta>`, cada uno con
 * su valor en el argumento siguiente y a lo más una vez. Cualquier otro argumento es un error.
 *
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {{date: string|null, out: string|null, errors: string[]}} `date` solo trae una fecha
 *   real (isIsoDate); cada problema deja un renglón en `errors`.
 */
function parsePreviewArgs(argv) {
    const parsed = { date: null, out: null, errors: [] };
    const args = Array.isArray(argv) ? argv : [];
    let sawDate = false;
    let sawOut = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg !== '--date' && arg !== '--out') {
            parsed.errors.push(`argumento no reconocido: ${arg}`);
            continue;
        }

        const value = args[i + 1];
        if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
            parsed.errors.push(`${arg} necesita un valor`);
            continue;
        }
        i++;

        if (arg === '--date') {
            if (sawDate) {
                parsed.errors.push('--date va una sola vez');
            } else if (!isIsoDate(value)) {
                parsed.errors.push('--date debe ser una fecha real YYYY-MM-DD');
            } else {
                parsed.date = value;
            }
            sawDate = true;
        } else {
            if (sawOut) {
                parsed.errors.push('--out va una sola vez');
            } else {
                parsed.out = value;
            }
            sawOut = true;
        }
    }

    return parsed;
}

/**
 * Cómo formatea este runtime la hora de medianoche con las opciones de getCurrentDate() (W-05,
 * D-35). Si la formateara como 24, getCurrentDate() armaría entre las 00:00 y las 00:59 un Date
 * del día siguiente.
 *
 * El formateador se construye aquí, en cada llamada, con `timeZone` igual al argumento y las demás
 * opciones copiadas literalmente de getCurrentDate() en src/utils/TimezoneHelper.js, sin agregar
 * ni quitar ninguna: la comprobación reproduce lo que hace ese helper, que esta fase no toca. Se
 * formatea la hora de los 24 instantes Date.UTC(2026, 10, 4, h, 5), h = 0..23, que cubren las 24
 * horas locales de cualquier zona. Solo lee: sin SQL ni disco.
 *
 * @param {string} timeZone - El TIMEZONE de TimezoneHelper.
 * @returns {string} '24' si alguna hora sale 24; '00' si alguna sale 00 y ninguna 24; '??' en
 *   cualquier otro caso, también si algo lanza.
 */
function readMidnightHourFormat(timeZone) {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const hours = [];
        for (let h = 0; h < 24; h++) {
            const parts = formatter.formatToParts(new Date(Date.UTC(2026, 10, 4, h, 5)));
            const hourPart = parts.find(part => part.type === 'hour');
            hours.push(hourPart ? hourPart.value : null);
        }
        if (hours.includes('24')) {
            return '24';
        }
        if (hours.includes('00')) {
            return '00';
        }
        return '??';
    } catch (err) {
        return '??';
    }
}

// Renglones de una sección del modelo, sumados entre sus grupos.
function sectionRowCount(sections, key) {
    const section = (sections && typeof sections === 'object') ? sections[key] : null;
    const groups = (section && Array.isArray(section.groups)) ? section.groups : [];
    return groups.reduce((total, group) => total + (Array.isArray(group.rows) ? group.rows.length : 0), 0);
}

// El mensaje de una excepción, o el valor rechazado si no es un Error.
function errorMessage(err) {
    return (err !== null && typeof err === 'object' && 'message' in err) ? String(err.message) : String(err);
}

/**
 * Arma la vista previa de un día y la guarda (RD-13, D-36): recolecta con collectDailySummary, arma
 * el HTML con buildDailySummaryHtml(model, { cap: false }) y lo escribe en `out` o en
 * `<LOG_PATH>/sageconnect/<D>/daily-summary-preview.html`. No envía correo ni toca el estado del
 * día. Una fecha que no es real se rechaza antes de cualquier consulta (D-11).
 *
 * Cierra el pool singleton de SQL Server en su finally, exactamente una vez por corrida y con
 * cualquier desenlace: las conexiones mínimas del pool dejarían vivo el proceso. Solo este script
 * lo cierra; el servicio comparte ese pool y nunca lo cierra (CLAUDE.md §3).
 *
 * @param {{date?: string|null, out?: string|null}} [options] - Sin `date`, hoy en TIMEZONE.
 * @returns {Promise<object>} ResultEnvelope con las cifras, el asunto, la ruta del HTML y el
 *   bloque clock.
 */
async function runDailySummaryPreview({ date = null, out = null } = {}) {
    const startTime = Date.now();
    try {
        const now = getCurrentDate();
        const dateISO = date == null ? localDateISO(now) : date;
        if (!isIsoDate(dateISO)) {
            return errorResult(
                ['La fecha debe ser una fecha real YYYY-MM-DD'],
                'No se armó la vista previa: fecha inválida',
                { startTime }
            );
        }

        const model = await collectDailySummary(dateISO, config);
        const html = buildDailySummaryHtml(model, { cap: false });
        const subject = buildDailySummarySubject(model);
        const htmlPath = out == null
            ? path.join(config.paths.logs, 'sageconnect', dateISO, PREVIEW_FILE_NAME)
            : path.resolve(out);
        fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
        fs.writeFileSync(htmlPath, html, 'utf8');

        const sections = {
            oc: sectionRowCount(model.sections, 'oc'),
            rejected: sectionRowCount(model.sections, 'rejected'),
            sage: sectionRowCount(model.sections, 'sage'),
        };
        const sqlClock = (model.clock !== null && typeof model.clock === 'object') ? model.clock : {};
        const clock = {
            tzNow: localStamp(now),
            tzDate: localDateISO(now),
            midnightHourFormat: readMidnightHourFormat(TIMEZONE),
            sqlDate: sqlClock.sqlDate ?? null,
            sqlNow: sqlClock.sqlNow ?? null,
            sqlOffsetMin: sqlClock.sqlOffsetMin ?? null,
        };

        console.table({ ...model.counts, pendingTotal: model.pendingTotal });
        console.table(sections);

        return successResult(
            {
                date: dateISO,
                htmlPath,
                subject,
                counts: model.counts,
                pendingTotal: model.pendingTotal,
                incomplete: model.incomplete,
                notes: model.notes,
                sections,
                clock,
            },
            `Vista previa del resumen del ${dateISO} guardada en ${htmlPath}`,
            { startTime }
        );
    } catch (err) {
        const message = errorMessage(err);
        logGenerator(LOG_FILE, 'error', `[FATAL] No se pudo armar la vista previa: ${message}`);
        return errorResult([message], 'No se pudo armar la vista previa', { startTime });
    } finally {
        try {
            await closePool();
        } catch (err) {
            logGenerator(LOG_FILE, 'warn', `[POOL] No se pudo cerrar el pool de SQL Server: ${errorMessage(err)}`);
        }
    }
}

async function main() {
    const args = parsePreviewArgs(process.argv.slice(2));

    if (args.errors.length > 0) {
        for (const error of args.errors) {
            console.log(`ERROR: ${error}`);
        }
        console.log('');
        console.log('Uso:');
        console.log('  node src/scripts/daily-summary-preview.js');
        console.log('  node src/scripts/daily-summary-preview.js --date 2026-11-03');
        console.log('  node src/scripts/daily-summary-preview.js --date 2026-11-03 --out <ruta>');
        process.exitCode = 1;
        return;
    }

    const envelope = await runDailySummaryPreview({ date: args.date, out: args.out });
    console.log('\n[RESULT]', JSON.stringify(envelope, null, 2));
    if (!envelope.success) {
        process.exitCode = 1;
    }
}

module.exports = { parsePreviewArgs, runDailySummaryPreview };

if (require.main === module) {
    main().catch(err => {
        console.error('FATAL:', err);
        process.exitCode = 1;
    });
}
