param()

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend\my-app"
$backendPython = Join-Path $backendDir "venv\Scripts\python.exe"

Write-Host "========================================"
Write-Host "   HOLO-ASSISTANT - Check Windows"
Write-Host "========================================"
Write-Host ""

if (-not (Test-Path $backendPython)) {
    throw "Virtualenv backend non trovato: $backendPython"
}

Write-Host "[1/2] Eseguo pytest backend..."
Push-Location $backendDir
try {
    & $backendPython -m pytest
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "[2/2] Eseguo smoke build frontend..."
Push-Location $frontendDir
try {
    npm run smoke:build
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "[OK] Controlli completati."
