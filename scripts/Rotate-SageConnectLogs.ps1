<#
.SYNOPSIS
    Rotates Servy logs for SageConnect to a dated archive folder.

.DESCRIPTION
    Designed to run daily at midnight via Task Scheduler. Safe to run while the
    SageConnect service is up:
      - Servy's already-rotated files (suffix .YYYYMMDD_HHMMSS) are MOVED entirely.
      - Active files (servy-stdout, servy-stderr) are SNAPSHOT and TRUNCATED via
        Clear-Content so Servy's open file handles are not broken.
      - Archive folders older than -RetentionDays are pruned.

    Default source: E:\sageconnect-dist\logs   (Capstone Copper prod layout)
    Default archive: C:\Logs\sageconnect\servy\yyyy-MM-dd

.PARAMETER SourceDir
    Folder containing servy-stdout / servy-stderr (and rotated siblings).
    Default: E:\sageconnect-dist\logs

.PARAMETER ArchiveRoot
    Root folder for dated archives. A subfolder named yyyy-MM-dd is created under it.
    Default: C:\Logs\sageconnect\servy

.PARAMETER RetentionDays
    Archive folders older than this many days are deleted at the end of the run.
    Default: 30

.EXAMPLE
    .\Rotate-SageConnectLogs.ps1
    Run with all defaults.

.EXAMPLE
    .\Rotate-SageConnectLogs.ps1 -SourceDir "D:\apps\sageconnect-dist\logs" -RetentionDays 90
    Custom source and longer retention.

.NOTES
    Register as a daily Task Scheduler job (run as SYSTEM, RunLevel Highest):

      $action    = New-ScheduledTaskAction -Execute 'powershell.exe' `
                       -Argument '-NoProfile -ExecutionPolicy Bypass -File E:\sageconnect-dist\scripts\Rotate-SageConnectLogs.ps1'
      $trigger   = New-ScheduledTaskTrigger -Daily -At '00:00'
      $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
      $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

      Register-ScheduledTask -TaskName 'SageConnect Servy Log Rotation' `
          -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
#>

[CmdletBinding()]
param(
    [string]$SourceDir    = 'E:\sageconnect-dist\logs',
    [string]$ArchiveRoot  = 'C:\Logs\sageconnect\servy',
    [int]   $RetentionDays = 30
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------
# Resolve destination folder for this run
# --------------------------------------------------------------------------
$dateStamp = (Get-Date).ToString('yyyy-MM-dd')
$timeStamp = (Get-Date).ToString('HHmmss')
$destDir   = Join-Path $ArchiveRoot $dateStamp

if (-not (Test-Path -LiteralPath $SourceDir)) {
    throw "Source directory not found: $SourceDir"
}

New-Item -ItemType Directory -Path $destDir -Force | Out-Null

$rotationLog = Join-Path $ArchiveRoot 'rotation.log'
$logLine = "$(Get-Date -Format o) [START] src=$SourceDir dest=$destDir"
Add-Content -LiteralPath $rotationLog -Value $logLine

# --------------------------------------------------------------------------
# 1) Move servy's already-rotated files (servy auto-rotates at ~10 MB).
#    Files match: servy-st*.YYYYMMDD_HHMMSS.log  (timestamp inserted before .log)
#    Active files (servy-stdout.log / servy-stderr.log) deliberately excluded
#    by the regex anchor — only rotated siblings are moved.
# --------------------------------------------------------------------------
$movedCount = 0
Get-ChildItem -Path $SourceDir -Filter 'servy-st*' -File |
    Where-Object { $_.Name -match '\.\d{8}_\d{6}\.log$' } |
    ForEach-Object {
        Move-Item -LiteralPath $_.FullName -Destination $destDir -Force
        $movedCount++
    }

# --------------------------------------------------------------------------
# 2) Snapshot + truncate active files. Clear-Content is the only safe choice:
#    Remove-Item fails with file-in-use; Set-Content / > redirect can break
#    Servy's open handle. Clear-Content truncates the file in place.
# --------------------------------------------------------------------------
$snapshotCount = 0
foreach ($name in @('servy-stdout.log', 'servy-stderr.log')) {
    $live = Join-Path $SourceDir $name
    if (Test-Path -LiteralPath $live) {
        $base     = [System.IO.Path]::GetFileNameWithoutExtension($name)  # 'servy-stdout'
        $ext      = [System.IO.Path]::GetExtension($name)                  # '.log'
        $snapshot = Join-Path $destDir ("{0}.{1}{2}" -f $base, $timeStamp, $ext)
        Copy-Item   -LiteralPath $live -Destination $snapshot -Force
        Clear-Content -LiteralPath $live
        $snapshotCount++
    }
}

# --------------------------------------------------------------------------
# 3) Prune archive folders older than RetentionDays
# --------------------------------------------------------------------------
$prunedCount = 0
if (Test-Path -LiteralPath $ArchiveRoot) {
    Get-ChildItem -Path $ArchiveRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-$RetentionDays) } |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
            $prunedCount++
        }
}

# --------------------------------------------------------------------------
# Done
# --------------------------------------------------------------------------
$summary = "moved=$movedCount snapshot=$snapshotCount pruned=$prunedCount retention=$RetentionDays"
Add-Content -LiteralPath $rotationLog -Value "$(Get-Date -Format o) [DONE]  $summary"
Write-Host "Servy log rotation complete: $summary"
Write-Host "Archive: $destDir"
