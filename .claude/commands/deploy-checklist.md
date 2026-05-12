---
description: Walk through the pre-deploy checklist for the Servy production cutover
---

Walk the operator through `docs/DEPLOYMENT.md` step by step. **Do not execute any of the commands** — production lives on a Windows Server, and these need to run there with Administrator rights. Your job is to print the right command for each step and confirm the operator can validate the result.

Checklist:

1. **Servy installed.** Verify with `servy-cli --version`. If absent: `winget install servy`, then restart the terminal.
2. **`.env` present at install dir.** Verify with `Test-Path E:\sageconnect\.env`. The file must contain DB, portal, license, and address vars — see `.env.example` and the variable lists in `README.md` § Environment Variables.
3. **Dependencies installed.** From `E:\sageconnect`, run `npm install --production`.
4. **Service installed.** Run `.\scripts\install-service.ps1` from an elevated PowerShell. The script is idempotent and will exit silently if `SageConnect` already exists.
5. **Service running.** Verify with `Get-Service SageConnect` — `Status` should be `Running`.
6. **Health endpoint live.** Verify with `Invoke-WebRequest http://localhost:3030/api/system/health`. Body should be `{"status":"ok",...}`.
7. **Logs flowing.** `Get-Content E:\sageconnect\logs\servy-stdout.log -Tail 20` should show the startup banner and license validation success.

For rollback (if needed) and troubleshooting (port conflicts, license errors, DB connectivity), point to the sections at the bottom of `docs/DEPLOYMENT.md`.

Read `docs/DEPLOYMENT.md` once at the start so the version-specific details (Servy parameters, expected paths) come from the source-of-truth document and not your memory of it.
