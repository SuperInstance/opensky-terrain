# Shoalwater — local pipeline launcher (Windows PowerShell)
# One command:  powershell -ExecutionPolicy Bypass -File .\run.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) {
    Write-Host "Creating Python environment (.venv)..."
    py -3 -m venv .venv
}
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

Write-Host "Installing/updating Python packages (numpy, pandas, scipy)..."
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet -r requirements.txt

Write-Host "Running the pipeline (see config.json for mode/settings)..."
& $py -m pipeline.run_local
if ($LASTEXITCODE -ne 0) { Write-Host "Pipeline stopped — see the message above."; exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done. To view your terrain:"
Write-Host "  1) Start the preview server:  .\.venv\Scripts\python.exe -m http.server 8765 --directory outputs"
Write-Host "  2) Open in your browser:      http://localhost:8765/"
Write-Host ""
Write-Host "Send back these small files (no raw soundings):"
Write-Host "  outputs\reports\RUN-REPORT.md, outputs\inventory.json, outputs\reports\csb_report.json (if present)"
