// EOM-01 / EOM-03 / EOM-04 / D-07 / D-08 / D-10 / D-15 / D-16: gate evaluation, atomic sentinel I/O, and HTML body builder for the end-of-month operator email.
// 20.2: RETRY-S3 / D-10 / D-11 — the payments table drops the error-description column (its control table cannot hold one); the POs table is unchanged.
// 20.5: Q3-03 / Q3-05 / D-06 / D-07 / D-09 / D-12 — biweekly payment-report gate (no exact-day term, the sentinel path carries the period) and a `po-alert` variant of the HTML body whose default output stays byte-identical.

const fs = require('fs');
const path = require('path');
const config = require('../config');

const LOG_FILE = 'EomNotification';

/**
 * Escape the five HTML-significant characters so dynamic row data cannot
 * break the surrounding markup. Defensive table-cell rendering — see
 * threat-model T-20-14 (HTML injection via `lastError`).
 *
 * @param {*} value - Any value; coerced to string before escaping.
 * @returns {string} HTML-safe string.
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Derive a `YYYY-MM` label. Pads the month to two digits.
 *
 * @param {Date} date - Date instance.
 * @returns {string} e.g. '2026-05'.
 */
function yyyyMm(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${date.getFullYear()}-${month}`;
}

/**
 * Decide whether the end-of-month operator email should be dispatched on this
 * cron tick. Clock-injected per CONTEXT D-16 — production passes `new Date()`,
 * tests pass a fixed `Date`. Fail-closed: any bad input returns `false`.
 *
 * Returns `true` only when ALL hold:
 *   - eomConfig.notificationEnabled === true   (short-circuit kill-switch, EOM-05)
 *   - `now` is the last calendar day of its month
 *   - now.getHours() >= eomConfig.notificationHour
 *   - the per-month sentinel file does NOT exist (EOM-04 idempotency)
 *
 * @example
 * shouldDispatchEom(new Date('2026-05-31T18:05:00Z'), 'logs/eom-2026-05-pos.sent', config.eom)
 * // => true | false
 *
 * @param {Date} now - Current time (clock injection).
 * @param {string} sentinelPath - Path to the per-month sentinel file.
 * @param {{notificationHour: number, notificationEnabled: boolean}} eomConfig - EOM config namespace.
 * @returns {boolean}
 */
function shouldDispatchEom(now, sentinelPath, eomConfig) {
    // Fail-closed on bad input — never dispatch on a malformed call.
    if (!eomConfig || typeof eomConfig !== 'object') {
        return false;
    }
    if (!eomConfig.notificationEnabled) {
        return false;
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        return false;
    }
    if (typeof sentinelPath !== 'string' || sentinelPath.length === 0) {
        return false;
    }

    // Last calendar day of `now`'s month — JS month-overflow trick: day 0 of
    // the next month is the last day of the current month.
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getDate() !== lastDay) {
        return false;
    }

    if (now.getHours() < eomConfig.notificationHour) {
        return false;
    }

    if (fs.existsSync(sentinelPath)) {
        return false;
    }

    return true;
}

/**
 * Resolve which half of the month a date falls in. Natural periods per CONTEXT
 * D-06: days 1 to 15 are period 1, day 16 to the end of the month is period 2.
 * February needs no special case — the upper period is defined as "16 or later",
 * never as "16 to 30", so 28-, 29-, 30- and 31-day months all resolve the same way.
 *
 * Fail-closed like the rest of the module: anything that is not a valid `Date`
 * yields `null` rather than a guessed period.
 *
 * @example
 * paymentPeriodOf(new Date(2026, 1, 28)) // => 2  (February needs no branch)
 *
 * @param {Date} date - Date instance.
 * @returns {1|2|null} Period ordinal, or `null` on bad input.
 */
function paymentPeriodOf(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
    }
    return date.getDate() <= 15 ? 1 : 2;
}

/**
 * Decide whether the biweekly pending-payment report should be dispatched on
 * this cron tick (Q3-03). Clock-injected per CONTEXT D-16 and fail-closed in the
 * same order as `shouldDispatchEom` above, so the two gates read as a pair.
 *
 * Returns `true` only when ALL hold:
 *   - reportConfig.enabled === true            (short-circuit kill-switch, Q3-04)
 *   - `now` is a valid Date and `sentinelPath` a non-empty string
 *   - now.getHours() >= reportConfig.hour
 *   - the per-period sentinel file does NOT exist (idempotency)
 *
 * D-07 — there is deliberately NO exact-day term here, and its absence IS the
 * decision. The period is carried by the sentinel PATH, which the caller builds
 * from `paymentPeriodOf(now)`. The predicate is therefore true on the FIRST tick
 * at or after the period start, and false on every tick once the sentinel lands.
 * Requiring the day to be exactly the 1st or the 16th would mean that a service
 * that was down, restarting or licence-blocked on that day loses the period's
 * report permanently and silently — nothing anywhere would report the gap. The
 * sentinel is what makes "at or after" idempotent, so no day term is needed at all.
 *
 * D-09 / Q3-04 — the kill-switch read here is `reportConfig.enabled`. It is
 * deliberately NOT the EOM key name
 * (`notificationEnabled`): the two namespaces use different key names because
 * they are independent switches, and reusing the EOM name here would invite a
 * later merge of `config.eom` into `config.notifications`.
 *
 * @example
 * // The 16th was missed; the period's report has still not gone out.
 * shouldDispatchPaymentReport(new Date(2026, 8, 20, 18, 5), 'logs/payment-report-2026-09-2.sent', config.notifications.paymentReport)
 * // => true
 *
 * @param {Date} now - Current time (clock injection).
 * @param {string} sentinelPath - Path to the per-period sentinel file.
 * @param {{hour: number, enabled: boolean}} reportConfig - `config.notifications.paymentReport`.
 * @returns {boolean}
 */
function shouldDispatchPaymentReport(now, sentinelPath, reportConfig) {
    // Fail-closed on bad input — never dispatch on a malformed call.
    if (!reportConfig || typeof reportConfig !== 'object') {
        return false;
    }
    if (!reportConfig.enabled) {
        return false;
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        return false;
    }
    if (typeof sentinelPath !== 'string' || sentinelPath.length === 0) {
        return false;
    }

    // Sin término de día, a propósito (D-07): el periodo lo lleva la ruta del
    // centinela, que el llamador arma con paymentPeriodOf(now). Añadir aquí una
    // comparación de día exacto haría que un servicio caído ese día perdiera el
    // reporte del periodo, en silencio y para siempre.
    if (now.getHours() < reportConfig.hour) {
        return false;
    }

    if (fs.existsSync(sentinelPath)) {
        return false;
    }

    return true;
}

/**
 * Build the HTML body for the end-of-month operator email. Pure — reads only
 * `config.app.baseUrl` (defaulting to `http://localhost:3030`) for the footer
 * links. Output is deterministic for fixed input (snapshot-tested).
 *
 * `rows` schema: Array<{tenant: string, idOrPo: string, fechaAuth: string|Date,
 * attempts: number, lastError: string|null}>. `lastError` is truncated to 100
 * chars with an ellipsis. Empty `rows` yields the "Sin pendientes" body per D-10.
 *
 * RETRY-S3 / 20.2 D-10 / D-11: `category` drives the table SHAPE, not just the intro
 * sentence. `lastError` is produced only by the `pos` query and consumed only by the
 * `pos` branch, so the POs table is six columns wide and the payments table is
 * deliberately five. The payments control table has four columns and none of them can
 * hold an error description, so the column is REMOVED rather than filled with a
 * placeholder: a cell that always reads "no registrado" trains the operator to ignore
 * it and normalises the gap. A single footnote states the gap once and keeps visible
 * pressure to resolve CR-03. The footnote renders in both the populated and the
 * "Sin pendientes" payments cases — the empty case is precisely when an operator might
 * otherwise conclude that nothing failed.
 *
 * @param {Array<object>} rows - Pending-document rows for one category.
 * @param {'pos'|'payments'} category - Drives the table title AND the table shape.
 * @returns {string} HTML string.
 */
function buildEomEmailHtml(rows, category) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const isPos = category !== 'payments';

    // YYYY-MM derived from the first row's authorization date, else current month.
    let monthLabel;
    if (safeRows.length > 0 && safeRows[0].fechaAuth) {
        const parsed = new Date(safeRows[0].fechaAuth);
        monthLabel = Number.isNaN(parsed.getTime()) ? yyyyMm(new Date()) : yyyyMm(parsed);
    } else {
        monthLabel = yyyyMm(new Date());
    }

    const baseUrl = (config.app && config.app.baseUrl) ? config.app.baseUrl : 'http://localhost:3030';
    const intro = isPos
        ? 'Resumen de POs pendientes de subir al portal al cierre del mes.'
        : 'Resumen de pagos pendientes de subir al portal al cierre del mes.';

    const lines = [];
    lines.push(`<h1>SageConnect: Pendientes fin de mes — ${monthLabel}</h1>`);
    lines.push(`<p>${intro}</p>`);

    if (safeRows.length === 0) {
        lines.push('<p>Sin pendientes en esta categoría este mes</p>');
    } else {
        lines.push('<table border="1" cellspacing="0" cellpadding="4">');
        lines.push('  <thead>');
        lines.push('    <tr>');
        // El encabezado y el cuerpo DEBEN ramificar juntos: si solo uno cambia la tabla
        // queda desalineada (6 encabezados sobre 5 celdas). La rama `pos` es byte a byte
        // la de siempre — tests/fixtures/eom-email-sample.html la fija (D-11).
        if (isPos) {
            lines.push('      <th>#</th><th>Tenant</th><th>PO / ID</th><th>Fecha autorización</th><th>Intentos</th><th>Último error</th>');
        } else {
            lines.push('      <th>#</th><th>Tenant</th><th>PO / ID</th><th>Fecha autorización</th><th>Intentos</th>');
        }
        lines.push('    </tr>');
        lines.push('  </thead>');
        lines.push('  <tbody>');
        safeRows.forEach((row, index) => {
            const commonCells =
                `    <tr><td>${index + 1}</td>` +
                `<td>${escapeHtml(row.tenant)}</td>` +
                `<td>${escapeHtml(row.idOrPo)}</td>` +
                `<td>${escapeHtml(row.fechaAuth)}</td>` +
                `<td>${escapeHtml(row.attempts)}</td>`;
            if (isPos) {
                // Truncado solo en la rama POs: en pagos no hay dato que truncar y el
                // valor no debe llegar a la salida. escapeHtml sigue envolviéndolo aquí
                // (amenaza T-20-14, inyección de HTML vía `lastError`).
                let lastError = row.lastError == null ? '' : String(row.lastError);
                if (lastError.length > 100) {
                    lastError = lastError.slice(0, 100) + '…';
                }
                lines.push(commonCells + `<td>${escapeHtml(lastError)}</td></tr>`);
            } else {
                lines.push(commonCells + '</tr>');
            }
        });
        lines.push('  </tbody>');
        lines.push('</table>');
    }

    // 20.2 D-10: una sola nota honesta. Va FUERA del if/else a propósito, para que
    // también aparezca en el caso "Sin pendientes" — ese es justamente el momento en que
    // un operador podría concluir que no falló nada. Literal fija, sin contenido
    // dinámico, por lo que no requiere escapeHtml.
    if (!isPos) {
        lines.push('<p><em>Nota: el sistema de control todavía no registra el detalle del error de cada pago, por lo que esta tabla no incluye una columna de descripción de error.</em></p>');
    }

    lines.push(`<p><a href="${baseUrl}/pos.html">Ver POs</a> | <a href="${baseUrl}/payments.html">Ver pagos</a></p>`);

    return lines.join('\n') + '\n';
}

/**
 * Write a sentinel file atomically: serialize to `${path}.tmp`, then
 * `fs.renameSync` it into place. POSIX rename is atomic on the same
 * filesystem, so a crash mid-write never leaves a half-written sentinel
 * (CONTEXT D-07). Parent directory is created recursively if missing.
 *
 * Throws on rename failure (e.g. cross-device link) — the caller wraps this
 * in try/catch and logs a warning. Does NOT swallow exceptions.
 *
 * @param {string} sentinelPath - Final sentinel path.
 * @param {{timestamp: string, success: boolean, error?: string, rowCount?: number}} payload - Sentinel payload.
 * @returns {void}
 */
function writeSentinelAtomically(sentinelPath, payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('writeSentinelAtomically: payload must be an object');
    }
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    const tmp = sentinelPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, sentinelPath);
}

/**
 * Read and parse a sentinel file. Returns `null` if the file is missing or the
 * contents are not valid JSON — never throws (CONTEXT D-07).
 *
 * @param {string} sentinelPath - Sentinel path.
 * @returns {{timestamp: string, success: boolean, error?: string, rowCount?: number}|null}
 */
function readSentinelPayload(sentinelPath) {
    if (typeof sentinelPath !== 'string' || !fs.existsSync(sentinelPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
    } catch (_e) {
        return null;
    }
}

module.exports = { shouldDispatchEom, shouldDispatchPaymentReport, paymentPeriodOf, buildEomEmailHtml, writeSentinelAtomically, readSentinelPayload };

// LOG_FILE retained for future callers routing entries via logGenerator(LOG_FILE, ...).
void LOG_FILE;
