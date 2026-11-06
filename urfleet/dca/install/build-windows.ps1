# Build a single-file urfleet-dca.exe (run on any Windows PC with Python 3.11+)
#   powershell -ExecutionPolicy Bypass -File build-windows.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
python -m pip install --upgrade pyinstaller
python -m PyInstaller --onefile --console --name urfleet-dca --distpath "$PSScriptRoot" `
  --workpath "$env:TEMP\urfleet-dca-build" --specpath "$env:TEMP\urfleet-dca-build" "$root\urfleet_dca.py"
Write-Host "Built $PSScriptRoot\urfleet-dca.exe"
Write-Host "Optional: sign it -> signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com urfleet-dca.exe"
