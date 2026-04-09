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
$piperVoiceModel = Join-Path $backendDir "app\services\voice_models\$DittoPiperDefaultVoiceModelFilename"
$piperVoiceConfig = Join-Path $backendDir "app\services\voice_models\$DittoPiperDefaultVoiceConfigFilename"

Write-Host "========================================"
Write-Host "   DITTO - Start Windows"
Write-Host "========================================"
Write-Host ""
if ($CheckOnly) {
    Write-DittoInfo "Modalita CheckOnly: nessun container, download, installazione o server verra' avviato."
}

if (Test-DittoNeedsWindowsAdminForDockerBootstrap -CheckOnly:$CheckOnly) {
    Write-DittoWarn "Per completare la preparazione Docker via WSL servono privilegi amministrativi."
    Write-DittoInfo "Richiedo i permessi ora, poi lo start continua solo nella finestra elevata."
    Start-DittoScriptElevated -ScriptPath $PSCommandPath
    exit 0
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
    $databaseHost = Get-DittoDatabaseHost
    Write-DittoInfo "Host database iniziale in configurazione: $databaseHost"
    $python = Get-DittoPythonCommand -CheckOnly:$CheckOnly
    Write-DittoOk "Python disponibile: $($python.Exe) $($python.Args -join ' ')"
    Ensure-DittoCommand -CommandName "node" -DisplayName "Node.js" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null
    Ensure-DittoCommand -CommandName "npm" -DisplayName "npm" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null
    $cert = Ensure-DittoHttpsCertificate -RootDir $rootDir -Ip $ip -CheckOnly:$CheckOnly

    $ollamaConfig = Get-DittoOllamaConfig -BackendEnvPath $backendEnvPath
    $ollamaRuntime = Get-DittoOllamaRuntime -Config $ollamaConfig -CheckOnly:$CheckOnly
    $wslStatus = Get-DittoWslStatus
    $dockerMode = if ($env:DITTO_DOCKER_MODE) { $env:DITTO_DOCKER_MODE } else { "non pronto" }

    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: runtime Ollama previsto: $(if ($ollamaRuntime.UseNative) { 'native' } else { 'docker' })"
        Write-DittoInfo "CheckOnly: stato WSL2: $($wslStatus.Summary)"
        Write-DittoInfo "CheckOnly: Docker effettivo: $dockerMode"
        Write-DittoInfo "CheckOnly: Ollama nativo disponibile: $([bool](Test-DittoCommand 'ollama'))"
        Write-DittoInfo "CheckOnly: Piper presente: $([bool]((Test-Path $piperVoiceModel) -and (Test-Path $piperVoiceConfig)))"
        Write-DittoInfo "CheckOnly: Vosk presente: $([bool](Test-Path $voskArchive))"
        Write-DittoInfo "CheckOnly: venv presente: $([bool](Test-Path (Join-Path $backendDir "venv")))"
        Write-DittoInfo "CheckOnly: node_modules presente: $([bool](Test-Path (Join-Path $frontendDir "node_modules")))"
        Write-DittoInfo "CheckOnly completato: start.ps1 e configurazione base sono leggibili."
        exit 0
    }

    if (-not (Test-Path $backendEnvPath)) {
        Write-DittoWarn "backend\.env non trovato: creo configurazione minima come setup."
        New-DittoBackendEnv -Path $backendEnvPath -Ip $ip -OllamaConfig $ollamaConfig -DatabaseHost $databaseHost
    }
    $databasePasswordLine = Select-String -Path $backendEnvPath -Pattern "^DATABASE_PASSWORD=" | Select-Object -First 1
    if ($databasePasswordLine) {
        $env:DATABASE_PASSWORD = $databasePasswordLine.Line.Split("=", 2)[1]
    }

    Write-DittoInfo "Rimuovo eventuale container Ollama legacy se presente..."
    Invoke-DittoDocker -Arguments @("rm", "-f", "ditto_ollama") -FailureMessage "Rimozione container Ollama residuo fallita." -AllowFailure | Out-Null
    Write-DittoInfo "Avvio o riallineo i servizi Docker richiesti: postgres e adminer..."
    Invoke-DittoDocker -Arguments @("compose", "-f", "docker-compose.yml", "up", "-d", "postgres", "adminer") -WorkingDirectory $dockerDir -FailureMessage "Avvio PostgreSQL/Adminer fallito."
    Write-DittoInfo "Attendo l'inizializzazione dei container..."
    Start-Sleep -Seconds 8
    if (-not (Wait-DittoPostgres -MaxAttempts 20)) {
        Show-DittoPostgresDiagnostics -DockerDir $dockerDir
        throw "PostgreSQL non e pronto nel container."
    }
    $databaseHost = Resolve-DittoReachableDatabaseHost -Port 5432
    Write-DittoInfo "Host database effettivo selezionato: $databaseHost"

    Set-DittoEnvValues -Path $backendEnvPath -Values @{
        "DATABASE_HOST" = $databaseHost
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

    Ensure-DittoPiperVoiceModel -RootDir $rootDir -BackendDir $backendDir

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
    Write-DittoInfo "Apro una nuova finestra per il backend FastAPI..."
    Start-DittoCmdWindow -Title "DITTO Backend" -Command $backendCommand
    Write-DittoOk "Backend avviato su https://$ip`:$DittoDefaultBackendPort"

    Write-DittoInfo "Attendo qualche secondo prima di aprire il frontend..."
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
    Write-DittoInfo "Apro una nuova finestra per il frontend Vite..."
    Start-DittoCmdWindow -Title "DITTO Frontend" -Command $frontendCommand
    Write-DittoOk "Frontend avviato su https://$ip`:$DittoDefaultFrontendPort"

    Write-Host ""
    Write-Host "========================================"
    Write-Host "   [OK] SERVIZI AVVIATI"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Apri il frontend da qui:"
    Write-Host "   - Locale: https://localhost:$DittoDefaultFrontendPort"
    Write-Host "   - Rete:   https://$ip`:$DittoDefaultFrontendPort"
    Write-Host ""
    Write-Host "Link tecnici:"
    Write-Host "   - Backend API: https://$ip`:$DittoDefaultBackendPort"
    Write-Host "   - API Docs:    https://$ip`:$DittoDefaultBackendPort/docs"
    Write-Host "   - Adminer DB:  http://localhost:8080"
    Write-Host ""
    Write-Host "[INFO] In sviluppo le chiamate API passano dal frontend tramite proxy Vite."
    Write-Host "[INFO] Su browser desktop o mobile di solito basta accettare il certificato del frontend."
    Write-Host "[INFO] Se apri il backend direttamente e il browser lo blocca, accetta anche: https://$ip`:$DittoDefaultBackendPort/health"
    Write-Host ""
    Write-Host "Per fermare il sistema, chiudi le finestre del terminale oppure esegui: cd docker && docker compose down"
} catch {
    Write-DittoError $_.Exception.Message
    exit 1
}
