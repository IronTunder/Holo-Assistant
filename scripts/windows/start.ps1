param(
    [switch]$CheckOnly
)

. "$PSScriptRoot\common.ps1"

$rootDir = Get-DittoRoot
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend\my-app"
$dockerDir = Join-Path $rootDir "docker"
$backendEnvPath = Join-Path $backendDir ".env"
$frontendEnvPath = Join-Path $frontendDir ".env"
$voskArchive = Join-Path $frontendDir "public\models\$DittoVoskModelArchiveName"

Write-Host "========================================"
Write-Host "   DITTO - Start Windows"
Write-Host "========================================"
Write-Host ""
if ($CheckOnly) {
    Write-DittoInfo "Modalita CheckOnly: nessun container, download, installazione o server verra' avviato."
}

try {
    if (-not (Test-Path (Join-Path $dockerDir "docker-compose.yml"))) {
        throw "File docker-compose.yml non trovato in $dockerDir"
    }
    if (-not (Test-Path $backendDir)) {
        throw "Directory backend non trovata: $backendDir"
    }
    if (-not (Test-Path $frontendDir)) {
        throw "Directory frontend non trovata: $frontendDir"
    }

    $ip = Get-DittoLocalIp
    Write-DittoInfo "IP del server: $ip"

    Write-DittoStep "[1/3] Verifica prerequisiti e avvio servizi Docker..."
    Ensure-DittoDocker -CheckOnly:$CheckOnly
    $python = Get-DittoPythonCommand -CheckOnly:$CheckOnly
    Write-DittoOk "Python disponibile: $($python.Exe) $($python.Args -join ' ')"
    Ensure-DittoCommand -CommandName "node" -DisplayName "Node.js" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null
    Ensure-DittoCommand -CommandName "npm" -DisplayName "npm" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null
    $cert = Ensure-DittoHttpsCertificate -RootDir $rootDir -Ip $ip -CheckOnly:$CheckOnly

    $ollamaConfig = Get-DittoOllamaConfig -BackendEnvPath $backendEnvPath
    $ollamaRuntime = Get-DittoOllamaRuntime -Config $ollamaConfig -CheckOnly:$CheckOnly

    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: runtime Ollama previsto: $(if ($ollamaRuntime.UseNative) { 'native' } else { 'docker' })"
        Write-DittoInfo "CheckOnly: venv presente: $([bool](Test-Path (Join-Path $backendDir "venv")))"
        Write-DittoInfo "CheckOnly: node_modules presente: $([bool](Test-Path (Join-Path $frontendDir "node_modules")))"
        Write-DittoInfo "CheckOnly completato: start.ps1 e configurazione base sono leggibili."
        exit 0
    }

    if ($ollamaRuntime.UseNative) {
        Invoke-DittoDocker -Arguments @("compose", "-f", "docker-compose.yml", "stop", "ollama") -WorkingDirectory $dockerDir -FailureMessage "Stop container Ollama fallito." -AllowFailure | Out-Null
        Invoke-DittoDocker -Arguments @("compose", "-f", "docker-compose.yml", "up", "-d", "postgres", "adminer") -WorkingDirectory $dockerDir -FailureMessage "Avvio PostgreSQL/Adminer fallito."
    } else {
        Invoke-DittoDocker -Arguments (@("compose") + $ollamaRuntime.ComposeArgs + @("up", "-d")) -WorkingDirectory $dockerDir -FailureMessage "Avvio stack Docker fallito."
    }
    Start-Sleep -Seconds 8
    Wait-DittoPostgres -MaxAttempts 20 | Out-Null

    if (-not (Test-Path $backendEnvPath)) {
        Write-DittoWarn "backend\.env non trovato: creo configurazione minima come setup."
        New-DittoBackendEnv -Path $backendEnvPath -Ip $ip -OllamaConfig $ollamaConfig
    }
    Set-DittoEnvValues -Path $backendEnvPath -Values @{
        "ALLOWED_ORIGINS" = "https://localhost:$DittoDefaultFrontendPort,https://$ip`:$DittoDefaultFrontendPort"
        "REFRESH_TOKEN_COOKIE_SECURE" = "true"
        "REFRESH_TOKEN_COOKIE_SAMESITE" = "lax"
    }
    Write-DittoOk "Impostazioni HTTPS backend aggiornate."

    Ensure-DittoOllamaModel -Config $ollamaConfig -Runtime $ollamaRuntime
    Invoke-DittoOllamaWarmup -Config $ollamaConfig

    Write-DittoStep "[2/3] Riparazione minima e avvio backend..."
    $venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        Write-DittoWarn "Ambiente virtuale backend mancante: provo a ricrearlo."
        Ensure-DittoBackendDependencies -BackendDir $backendDir -Python $python
    } else {
        Write-DittoOk "Ambiente virtuale backend presente."
    }

    $venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
    if (Test-Path (Join-Path $backendDir "scripts\seed_categories.py")) {
        Write-DittoInfo "Riallineamento knowledge base tecnica..."
        $seedExit = Invoke-DittoTool -FilePath $venvPython -Arguments @("scripts\seed_categories.py") -WorkingDirectory $backendDir
        if ($seedExit -ne 0) {
            Write-DittoWarn "Riallineamento knowledge base non completato."
        } else {
            Write-DittoOk "Knowledge base riallineata."
        }
    }

    $backendCommand = "cd /d `"$backendDir`" && call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port $DittoDefaultBackendPort --ssl-certfile `"$($cert.CertFile)`" --ssl-keyfile `"$($cert.KeyFile)`" --no-use-colors"
    Start-DittoCmdWindow -Title "DITTO Backend" -Command $backendCommand
    Write-DittoOk "Backend avviato su https://$ip`:$DittoDefaultBackendPort"

    Start-Sleep -Seconds 5

    Write-DittoStep "[3/3] Riparazione minima e avvio frontend..."
    if (-not (Test-Path $voskArchive)) {
        Write-DittoInfo "Modello Vosk mancante: provo a prepararlo."
        $voskExit = Invoke-DittoTool -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $rootDir "scripts\windows\prepare_vosk_model.ps1"))
        if ($voskExit -ne 0) {
            Write-DittoWarn "Impossibile preparare il modello Vosk automaticamente."
        } else {
            Write-DittoOk "Modello Vosk pronto."
        }
    } else {
        Write-DittoOk "Modello Vosk gia' presente."
    }

    Set-Content -Path $frontendEnvPath -Value @(
        "VITE_API_URL=https://$ip`:$DittoDefaultBackendPort",
        "VITE_VOSK_MODEL_URL=$DittoVoskModelPublicUrl"
    ) -Encoding ascii
    Write-DittoOk "frontend\my-app\.env aggiornato."

    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        Write-DittoWarn "node_modules mancante: provo a reinstallare le dipendenze frontend."
        Ensure-DittoFrontendDependencies -FrontendDir $frontendDir
    } else {
        Write-DittoOk "Dipendenze Node.js gia' installate."
    }

    $frontendCommand = "cd /d `"$frontendDir`" && npm run dev -- --host 0.0.0.0"
    Start-DittoCmdWindow -Title "DITTO Frontend" -Command $frontendCommand
    Write-DittoOk "Frontend avviato su https://$ip`:$DittoDefaultFrontendPort"

    Write-Host ""
    Write-Host "========================================"
    Write-Host "   [OK] SERVIZI AVVIATI"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Frontend locale: https://localhost:$DittoDefaultFrontendPort"
    Write-Host "Frontend rete:   https://$ip`:$DittoDefaultFrontendPort"
    Write-Host "Backend API:     https://$ip`:$DittoDefaultBackendPort"
    Write-Host "API Docs:        https://$ip`:$DittoDefaultBackendPort/docs"
    Write-Host "Adminer DB:      http://localhost:8080"
    Write-Host ""
    Write-Host "[INFO] Su dispositivi mobile potrebbe comparire un avviso certificato."
    Write-Host "[INFO] Se le API non rispondono, apri e accetta anche: https://$ip`:$DittoDefaultBackendPort/health"
    Write-Host ""
    Write-Host "Per fermare il sistema, chiudi le finestre del terminale oppure esegui: cd docker && docker compose down"
} catch {
    Write-DittoError $_.Exception.Message
    exit 1
}
