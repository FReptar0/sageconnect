# Operations runbook

This is the day-to-day runbook for the operator running SageConnect in production. It is **not** for developers — for development, start at [`ONBOARDING.md`](ONBOARDING.md). For installs and cutovers, [`DEPLOYMENT.md`](DEPLOYMENT.md) is the authority.

The service runs as a Windows service named `SageConnect` under [Servy](https://github.com/servy-dev/servy), with internal `node-cron` scheduling. There is one production host per customer.

> **Current production deployment (Capstone Copper):**
> - App server: `ZCL-RDS-02` (Windows Server, Servy + Node 22.15.0).
> - Install directory: **`E:\sageconnect-dist\`** (the obfuscated dist repo — the source-side `E:\sageconnect\` path that older docs reference does not exist in prod).
> - SQL Server: `ZCL-SQL-01` (separate host) — Sage 300 DB = `COPDAT`, control DB = `FESA`, login `sage` (mapped `dbo` in COPDAT).
> - Long-term log archive: `C:\Logs\sageconnect\servy\YYYY-MM-DD\`.
>
> `COPDAT` is the Sage 300 database name and is immutable — `Invalid object name` errors against `APBTA`, `POPORH1`, `APVENO`, `BKACCT`, `APTCR` etc. are never caused by the wrong DB name; investigate schema, permissions, `USE [DB]` context, or table prefix instead.

## Daily checks (2 minutes)

1. **Service is running.**
   ```powershell
   Get-Service SageConnect
   ```
   Status should be `Running`. If it's `Stopped`, see § "Service won't start" below.

2. **Health endpoint responds.**
   ```powershell
   Invoke-WebRequest http://localhost:3030/api/system/health | Select-Object -ExpandProperty Content
   ```
   Run from `ZCL-RDS-02` itself.
   Expected JSON: `{"status":"ok","uptime":<seconds>,...}`. Any other shape (or no response) means the Node process isn't healthy even if Servy reports `Running`.

3. **Dashboard is accessible.**
   Open `http://localhost:3030/schedule.html` from the server (or from a browser on the same LAN if the firewall permits). The page should load without a red "Licencia inactiva" banner and without an "Operación en curso" card stuck for more than ~15 minutes.

## Dashboard pages — what each one is for

| Page | What it shows | When to use it |
|------|---------------|----------------|
| `/schedule.html` | Cron schedule, last/next run, "Operación en curso" card with 5 s polling + 1 s heartbeat, "Ejecutar Ahora", "Forzar liberación". | Default landing page. Glance at the card to see if a cycle is mid-flight. |
| `/payments.html` | Payment reconciliation audit, 5-category drill-down. | When the AP team asks "why didn't payment X land in the portal?". |
| `/pos.html` | Purchase-order diagnostics, "Cambiar Estado OC" form (Abierta / Cerrada / Cancelada / Generada). | When a buyer needs an OC re-opened or cancelled in the portal. |
| `/logs.html` | Per-date, per-process winston logs. | First stop when something looks wrong — `ForResponse.log`, `CronScheduler.log`, `ChildProcess.log` are the most informative. |

## "Operación en curso" + Forzar liberación

The card on `/schedule.html` is your live view of the cron tick. It shows the current step (e.g. `downloadCFDI` for tenant 0) and a heartbeat ticker incrementing every second.

If the card is stuck on the same step for more than ~15 minutes:

1. Wait for the auto-release. `LOCK_TIMEOUT_MS` defaults to 14 minutes — the service will release the lock on its own, log a `[TIMEOUT]` entry, and email `LICENSE_ADMIN_EMAIL`.
2. If you need to recover sooner, click **Forzar liberación**, confirm the modal. The endpoint is idempotent — a second click won't error.
3. After force-release, the next cron tick (within 15 min by default) will pick up the work. If it gets stuck again, escalate to the dev (see § Escalation).

## Reading logs

**Application logs** live at:

```
E:\sageconnect-dist\logs\sageconnect\YYYY-MM-DD\
```

with one file per process / route / controller. The 5 most useful for triage:

- `ForResponse.log` — the cron orchestration. `[START]`, `[COMPLETE]`, `[TIMEOUT]` entries by tenant index.
- `CronScheduler.log` — node-cron decisions, lock acquisition, `lock:timeout` events.
- `ChildProcess.log` — the `ImportaFacturasFocaltec.exe` spawn, SIGTERM cascade, taskkill events.
- `LicenseValidator.log` — license check outcomes, cache hits, retry attempts.
- `ServerStatus.log` — startup banner and graceful shutdown lines.

**Servy logs** (the wrapper around the Node process) live at:

```
E:\sageconnect-dist\logs\servy-stdout.log
E:\sageconnect-dist\logs\servy-stderr.log
```

Active files use the bare names above. When stdout reaches ~10 MB, Servy auto-rotates to `servy-stdout.YYYYMMDD_HHMMSS.log` (timestamp inserted **between** the basename and `.log`, not at the end). `Rotate-SageConnectLogs.ps1` moves rotated files into `C:\Logs\sageconnect\servy\YYYY-MM-DD\` and clears the active ones with `Clear-Content` (preserves Servy's open file handle). Never `Remove-Item` an active file while the service is running — that breaks Servy's logging until restart.

Regex to identify rotated (not-active) files: `\.\d{8}_\d{6}\.log$`.

Quick tail commands:

```powershell
Get-Content E:\sageconnect-dist\logs\servy-stdout.log -Tail 50
Get-Content E:\sageconnect-dist\logs\servy-stdout.log -Wait -Tail 20

Get-ChildItem E:\sageconnect-dist\logs\sageconnect\<YYYY-MM-DD>\*.log | `
    Sort-Object LastWriteTime -Descending | `
    Select-Object -First 5
```

## Cron schedule

Default: `*/15 * * * *` (every 15 minutes). Override via `CRON_SCHEDULE` in `.env`.

The schedule runs in the timezone defined by `TIMEZONE` (typically `America/Mexico_City`). Cycles do not overlap — if a cycle is still running when the next tick fires, the new tick is skipped and a log entry recorded.

To trigger a cycle manually, use the **Ejecutar Ahora** button on `/schedule.html`. It acquires the same lock the cron uses, so it can't double-run.

## Daily summary email (off by default)

Since phase 20.7 the service can send one email a day that sums up the day's uploads and lists what the automatic retries could not upload. It ships **off**. This section covers how to review it, turn it on and check it.

### What it sends

One email a day for all tenants, to `MAILING_NOTICES` with a copy to `MAILING_CC`. It goes out at the end of the first cycle that **starts** at or after `DAILY_SUMMARY_TIME` (default `23:45`, the last cycle of the day). It says how many OCs and payments were uploaded that day and details what was retried without success:

- OCs not uploaded, grouped by reason;
- payments rejected by the portal, grouped by code;
- payments held by Sage data (vendor without a portal ID, invoices without a UUID, no invoices).

Each section shows at most 100 rows; the email names the preview command for the rest (§ Preview).

The email covers the calendar day (in `TIMEZONE`) on which it is sent, not the previous one: the one sent at 23:45 on 3 November summarizes 3 November. Only a summary that did not go out and is made up the next day carries the previous day's date (§ Retries). That is why a summary "at midnight" is configured as `23:45`, the default, and not as `00:00`: the time is compared against the start of the cycle, and with a cycle every 15 minutes 23:45 is the last cycle of the day, so the email covers the whole day. At `00:00` it would summarize the day that is just starting, with a single cycle, and whatever fails later that day would not appear in any summary. Any early-morning time has the same problem.

The OC side of the email only reflects the attempts recorded that day in the OC control table (its `ERROR` and `POSTED` rows). If the OC step tried nothing, no row is written and the email says 0 OCs uploaded and 0 not uploaded, with no note: that happens when its selection query fails in every cycle, or when the cycle stops before reaching that step. So "sin pendientes" does not guarantee that the OC step ran. If the day's OC counts look too low, open that day's `PortalOC_Creator.log` (§ Reading logs): each cycle that reaches the OC step leaves `Iniciando createPurchaseOrders` there when its selection query works and `Error al ejecutar la consulta SQL` when it fails; a day with neither means the step never ran.

An OC whose `ERROR` row cannot be written (for example, because its portal error or its validation message contains an apostrophe) does more than disappear from the email: the failed write stops that tenant's OC step at that OC, in every cycle while the same error comes back. The OCs after it are not attempted and do not appear either, and that tenant's later steps in the cycle (order changes and closing) do not run. `Iniciando createPurchaseOrders` is still logged in that case, so it does not prove the step finished: look in that day's `ForResponse.log` for `[ERROR] Error procesando el índice <n>` with an SQL syntax message (`Unclosed quotation mark…` or `Incorrect syntax near…`), and in `PortalOC_Creator.log` for an `Error enviando PO <OC>` line that is not followed by `marcada ERROR en FESA`. This comes from code older than the daily summary, so it can happen with the summary off; its fix is pending as its own task.

### Switches

Since phase 20.7 the four email switches — `DAILY_SUMMARY_ENABLED`, `EOM_NOTIFICATION_ENABLED`, `PO_ALERT_ENABLED` and `PAYMENT_REPORT_ENABLED` — are `false` when their line is missing. Each one is turned on with `true`, and turning one on does not turn on the others. Any other value (`no`, `1`, `yes`, …) stops startup with `[CONFIG ERROR]` naming the variable. `DAILY_SUMMARY_TIME` is `HH:MM` in 24-hour time with two digits (`00:00`–`23:59`), in `TIMEZONE`; any other format also stops startup with `[CONFIG ERROR]`.

Intended configuration when turning it on: only these two lines. The immediate OC alert and the fortnightly payment report stay off.

```
DAILY_SUMMARY_ENABLED=true
EOM_NOTIFICATION_ENABLED=true
```

### How to turn it on

1. Edit `.env` in the install directory.
2. From the install directory, validate it before restarting:
   ```powershell
   node src/config.js
   ```
   It must not print `[CONFIG ERROR]`. If it does, fix the variable it names and run it again.
3. Restart the service as described in § Service control (`.env` changes only take effect on restart).
4. In that day's `EomNotification.log`, look for the startup line:
   ```
   [NOTIFICATIONS] po-alert=off eom=on payment-report=off daily-summary=on daily-summary-time=23:45
   ```

To turn it off, set `DAILY_SUMMARY_ENABLED=false` (or remove the line) and restart the same way.

### Files of the day

They live in the day's log folder, `<LOG_PATH>\sageconnect\<YYYY-MM-DD>\`, the same folder as the application logs (§ Reading logs):

| File | What it is |
|------|------------|
| `daily-summary.json` | State of that day's summary: `pending`, `delivered` or `abandoned`, with its attempts. |
| `daily-summary-payments.json` | The day's payment ledger (the last result of each payment). Written on every payment run, even with the summary off. |
| `daily-summary-preview.html` | Output of the preview (§ Preview). |

A `pending` state whose last attempt has `"delivered": null` means the process stopped between recording the attempt and recording its outcome. It counts as a failed attempt and is not resent right away. A leftover `daily-summary.json.tmp` next to it is harmless: the next write replaces it.

### Preview

```powershell
node src/scripts/daily-summary-preview.js
node src/scripts/daily-summary-preview.js --date 2026-11-03
node src/scripts/daily-summary-preview.js --date 2026-11-03 --out <path>
```

Builds the same HTML as the email for that day (default: today in `TIMEZONE`), without the row cap or text clipping, and saves it (default: `daily-summary-preview.html` in the day's folder). Open it in a browser. It sends no email, only reads (SQL `SELECT` statements and the payment ledger) and does not touch the day's state, so it works with the summary off: use it to review the backlog before turning the summary on.

It prints `[RESULT]` with the counts, the subject, the HTML path and the `clock` block. An invalid argument or a failure exits with code 1; a failure also leaves a `[FATAL]` line in `DailySummaryPreview.log`.

### Clock check after installing

Run the preview once on each server and check the `clock` block of `[RESULT]`. Don't run it right around midnight, when the two dates can straddle the change of day.

- `clock.sqlDate` must equal `clock.tzDate`.
- `clock.sqlOffsetMin` must be `-360` with `TIMEZONE=America/Mexico_City`.
- `clock.midnightHourFormat` must be `00`.

If the date or the offset don't match, do not turn the summary on on that server: near midnight the OC rows would fall into another day. If `sqlDate`, `sqlNow` and `sqlOffsetMin` are `null`, the SQL query failed (see `notes`); fix that before deciding.

If `midnightHourFormat` is not `00` (`24` or `??`), do not turn it on on that server either: between 00:00 and 00:59 the service clock would fall into another day, and the summary, its state and that hour's payment ledger would go to the wrong day. Open a separate task to set `hourCycle: 'h23'` in `src/utils/TimezoneHelper.js`; that touches a shared helper and is outside phase 20.7.

While running, the service also logs `[DAILY-SUMMARY-CLOCK]`, which only compares the date with SQL Server's.

### Retries

If the email fails, that day gets at most 4 attempts: when it is due, then each one 1 h, 3 h and 8 h after the previous one. With a cycle every 15 minutes and the default time that is 23:45, 00:45, 03:45 and 11:45. If cycles were missed (the service was stopped, or a long cycle held the lock), the next attempt goes out in the first cycle after its wait and the ones after it keep their spacing: they are never sent back to back. After the fourth failure the day becomes `abandoned`. A day that is still `pending` keeps getting its attempts until the next summary is due: on the same day after the summary time, and on the next day before it. With the default `23:45` its retries all fall on the next day; with an earlier time, such as `12:00`, the first ones fall on the same day. A day whose summary time passed without any cycle (for example, the service was stopped at 23:45) is made up the same way, in the first cycle of the next day. When the next summary is due, the previous day is abandoned if it is still `pending`. Older days are never made up.

### Log tags

All of them go to that day's `EomNotification.log`:

| Tag | What it records |
|-----|-----------------|
| `[NOTIFICATIONS]` | Startup line with the four switches and the summary time. |
| `[DAILY-SUMMARY]` | One line per attempt: date, attempt n/4, whether it was delivered, and the counts. With `status=state-unreadable`, the day's state file could not be read (permissions, or another process holding it open): nothing is done for that day until a later cycle can read it, so no email goes out for it meanwhile. This line repeats every cycle while it lasts; check the file's permissions and what has it open. |
| `[DAILY-SUMMARY-ABANDON]` | A day given up, with the reason. |
| `[DAILY-SUMMARY-CLOCK]` | When summarizing today, the SQL Server date differs from the `TIMEZONE` date. |
| `[DAILY-SUMMARY-LEDGER]` | Warnings about the payment ledger. |

Nothing is logged per cycle while the summary is off or has nothing to do, except `status=state-unreadable` while the day's state file cannot be read. `EomNotification` does not appear in `/logs.html` yet: read the file directly (§ Reading logs).

### Manual payment retries

`node src/scripts/retry-month-payments.js --apply` reuses `uploadPayments`, the same path the cycle uses, so its results go into that day's payment ledger and show up in that day's summary. Run it outside a service cycle (check the "Operación en curso" card on `/schedule.html` first): two processes would write the same day file, and the last one to write wins.

## Service control

```powershell
# Status
Get-Service SageConnect
servy-cli status --name=SageConnect

# Restart
Restart-Service SageConnect

# Stop
Stop-Service SageConnect

# Start
Start-Service SageConnect

# Uninstall (Administrator required)
servy-cli uninstall --name=SageConnect
```

A `Restart-Service` triggers Servy's 30 s graceful stop window before SIGKILL. Use it when you need a clean state — e.g., after editing `.env` (changes only take effect on restart).

## License banner / expiry badge

The dashboard shows a yellow badge when the license has < 30 days remaining and a red badge when < 7 days. The maintainer should be notified well before red — the service exits at boot once the license is past expiry, and the next restart fails fast.

If the dashboard shows a sticky red "Licencia inactiva" banner across all pages, the validator considers the license INVALID or ERROR. Check:

- Network connectivity to `LICENSE_API_URL` (try `Invoke-WebRequest` from the server).
- The clock — anti-replay enforces 5-minute timestamp freshness, so a server clock skewed by more than 5 minutes will be rejected.
- The maintainer for license rotation.

## Common operational fixes

### Service won't start

1. Check Servy stderr:
   ```powershell
   Get-Content E:\sageconnect-dist\logs\servy-stderr.log -Tail 50
   ```
2. If you see `[CONFIG ERROR] Missing required environment variables`, fix `.env` and `Start-Service SageConnect`.
3. If you see `[LICENSE] Startup blocked`, the validator failed — see § License banner above.
4. If you see `Error: listen EADDRINUSE :::3030`, something else is on port 3030:
   ```powershell
   netstat -ano | findstr :3030
   taskkill /pid <PID> /f
   Start-Service SageConnect
   ```
5. If the service reached max restart attempts (5), it stops itself to avoid a thrashing loop. Investigate the root cause in the logs, then `Start-Service SageConnect` once you've fixed it.

### Port 3030 conflict

See step 4 above.

### Disk filling with logs

Verify `scripts/Rotate-SageConnectLogs.ps1` is registered as a scheduled task and running. If not, set it up per [`DEPLOYMENT.md`](DEPLOYMENT.md). Manually rotating once is safe:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Scripts\Rotate-SageConnectLogs.ps1
```

(`Rotate-SageConnectLogs.ps1` is staged at `C:\Scripts\` on the prod server — separate from the dist repo so it survives the `git reset --hard` cycle.)

Do **not** delete `servy-stdout.log` or `servy-stderr.log` while the service is running — Servy holds the file handle and deletion can break its logging until restart. Use `Clear-Content` (the rotation script does this) or restart the service first.

### Many `[TIMEOUT]` entries in logs

A burst of timeouts usually means the Focaltec portal is degraded or the Sage SQL Server is slow. Wait one or two cycles; the defense-in-depth tiers (axios 30 s → step 5 m → child 10 m → lock 14 m) will recover automatically. If timeouts persist for more than an hour, escalate.

A single `Child process timeout` event also dispatches an email to `LICENSE_ADMIN_EMAIL` — that's by design (Phase 19 D-15).

### Suspicious "missing CFDI" reports from the AP team

The reconciliation flow has an authorization lag inside the portal itself before CFDIs become visible to SageConnect (`getTypeI` filters on `stage=PENDING_TO_PAY`). Check `/payments.html` for the CFDI; if it's there, the AP team likely just saw a stale report. If it's not, escalate with the CFDI UUID(s).

## When to call the developer

Escalate same-day for:

- Service repeatedly crashing after restart (Servy hitting max-restart).
- License banner red and license token confirmed valid by the maintainer.
- Auto-release firing on every cycle for more than two consecutive cycles.
- `[TIMEOUT] step=… err=…` entries with `err=` showing anything that looks like a code-path failure (not a network timeout).
- Sudden absence of CFDI / payment processing despite the cron ticking.

Escalate the next business day for:

- Disk space slowly trending up (rotation not keeping pace).
- AP team report of one or two missing CFDIs.
- Dashboard slowness without service-side errors.

Always include the affected timestamp window and which log files you've already inspected — `Get-Content … -Tail 50` of the relevant `.log` files in a paste is the fastest path to an answer.

## Pointers

- Installation and cutover — [`DEPLOYMENT.md`](DEPLOYMENT.md).
- Architecture overview — [`ARCHITECTURE.md`](ARCHITECTURE.md).
- Security and license model — [`../SECURITY.md`](../SECURITY.md).
- Always-on failure example — [`../.planning/forensics/report-20260427-220000.md`](../.planning/forensics/report-20260427-220000.md).
