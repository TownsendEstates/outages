<#
  UrFleet DCA — Windows installer
  Run in an elevated PowerShell on an always-on PC/server at the client site:

    powershell -ExecutionPolicy Bypass -File install-windows.ps1 `
        -Endpoint "https://<project>.supabase.co/functions/v1/dca-ingest" `
        -Key "dca_xxxxxxxx..." -Ranges "192.168.1.0/24" -SiteName "Main office"

  Installs urfleet-dca.exe to C:\Program Files\UrFleet\DCA, writes the config to
  C:\ProgramData\UrFleet\DCA\dca.json (ACL: SYSTEM + Administrators only) and registers
  a Scheduled Task "UrFleet DCA" that runs at startup as SYSTEM and restarts on failure.
  Outbound HTTPS (443) to *.supabase.co is the only network requirement. No inbound ports.
#>
param(
  [Parameter(Mandatory = $true)][string]$Endpoint,
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Ranges = "",
  [string]$Communities = "public",
  [string]$SiteName = "",
  [string]$ExePath = "$PSScriptRoot\urfleet-dca.exe"
)
$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated (Administrator) PowerShell."
}
if (-not (Test-Path $ExePath)) { throw "urfleet-dca.exe not found at $ExePath" }

$InstallDir = Join-Path $env:ProgramFiles "UrFleet\DCA"
$DataDir    = Join-Path $env:ProgramData  "UrFleet\DCA"
New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null

# Stop an existing task before replacing the binary
$TaskName = "UrFleet DCA"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
Copy-Item $ExePath (Join-Path $InstallDir "urfleet-dca.exe") -Force
$Exe = Join-Path $InstallDir "urfleet-dca.exe"
$Cfg = Join-Path $DataDir "dca.json"

$initArgs = @("-c", $Cfg, "init", "--endpoint", $Endpoint, "--key", $Key, "--site-name", $SiteName)
foreach ($r in ($Ranges -split "[,; ]+" | Where-Object { $_ })) { $initArgs += @("--range", $r) }
foreach ($c in ($Communities -split "[,; ]+" | Where-Object { $_ })) { $initArgs += @("--community", $c) }
& $Exe @initArgs
if ($LASTEXITCODE -ne 0) { throw "DCA init failed" }

# Lock the config down: it contains the DCA key
icacls $Cfg /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)" | Out-Null

# Scheduled task: at startup, as SYSTEM, restart every minute on failure, no time limit
$action    = New-ScheduledTaskAction -Execute $Exe -Argument "-c `"$Cfg`" run" -WorkingDirectory $DataDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
              -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description "UrFleet Data Collection Agent — printer meters & supplies" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "UrFleet DCA installed." -ForegroundColor Green
Write-Host "  Binary : $Exe"
Write-Host "  Config : $Cfg"
Write-Host "  Logs   : $DataDir\dca.log"
Write-Host "Test now : & '$Exe' -c '$Cfg' once -v"
