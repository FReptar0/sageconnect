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
