/**
 * AdminEmailSender — extracted helper module for admin alert emails (Quick task 260502-i7l).
 *
 * PATTERNS.md §S-6 third-use trigger: sendAdminAlert was inlined in CronScheduler.js
 * (Phase 18 Plan 18-01) and schedule-routes.js (Phase 18 Plan 18-02). Providers_Downloader.js
 * (Quick task 260502-i7l, 3rd call site) triggers refactor-just-in-time per the convention.
 *
 * Mirrors LicenseValidator.sendLicenseAlert pattern — uses nodemailer directly (NOT the
 * project's operator-facing email-sender utility). The operator utility routes to
 * config.mailing.notices (operator mailbox); admin alerts route to config.license.adminEmail.
 *
 * The `callerLogFile` parameter PRESERVES the existing [ADMIN-EMAIL] log routing — each
 * caller passes its own LOG_FILE name so log entries appear in the same file they did
 * before the refactor (CronScheduler.log, ScheduleRoutes.log, Providers_Downloader.log).
 * Operators who grep for [ADMIN-EMAIL] in a specific log file continue to find them.
 *
 * Email failures are swallowed (warn log) and MUST NOT block the caller's flow —
 * lock-recovery, force-release, and XML generation all rely on this contract.
 */

const nodemailer = require('nodemailer');
const config = require('../config');
const { logGenerator } = require('./LogGenerator');

/**
 * Send an alert email to the LICENSE_ADMIN_EMAIL recipient.
 *
 * @param {string} subject       — already includes the [SageConnect] prefix when called.
 * @param {string} html          — full HTML body of the message.
 * @param {string} callerLogFile — log file name for [ADMIN-EMAIL] entries (e.g.,
 *                                  'CronScheduler', 'ScheduleRoutes', 'Providers_Downloader').
 *                                  Defaults to 'AdminEmailSender' if missing (safety fallback).
 */
async function sendAdminAlert(subject, html, callerLogFile) {
    const logFile = callerLogFile || 'AdminEmailSender';
    try {
        const transportConfig = {
            host: config.mailing.server,
            port: config.mailing.port,
            secure: config.mailing.ssl,
        };
        if (config.mailing.password) {
            transportConfig.auth = {
                user: config.mailing.from,
                pass: config.mailing.password,
            };
        }
        const transport = nodemailer.createTransport(transportConfig);
        await transport.sendMail({
            from: config.mailing.from,
            to: config.license.adminEmail,
            subject,
            html,
        });
        logGenerator(logFile, 'info', '[ADMIN-EMAIL] Sent to ' + config.license.adminEmail + ': ' + subject);
    } catch (err) {
        logGenerator(logFile, 'warn', '[ADMIN-EMAIL] Failed to send admin alert: ' + err.message);
    }
}

/**
 * Find the most recent stepProgress entry whose finishedAt is null/missing.
 * Returns null if stepProgress is empty or every entry is closed.
 *
 * Extracted from CronScheduler.js (Phase 18 Plan 18-01) and schedule-routes.js
 * (Phase 18 Plan 18-02). Both call sites used identical 5-line iteration; centralized
 * here at the same time as sendAdminAlert (related purpose: both helpers feed admin
 * email body fields stuckOnStep + stuckOnTenant).
 *
 * @param {Array<{step: string, tenant: string|null, startedAt: string, finishedAt: string|null, error: string|null}>} stepProgress
 * @returns {object|null}
 */
function findLastOpenStep(stepProgress) {
    if (!Array.isArray(stepProgress)) return null;
    for (let i = stepProgress.length - 1; i >= 0; i--) {
        if (!stepProgress[i].finishedAt) return stepProgress[i];
    }
    return null;
}

module.exports = { sendAdminAlert, findLastOpenStep };
