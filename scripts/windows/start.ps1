param(
    [switch]$CheckOnly
)

. "$PSScriptRoot\common.ps1"

$rootDir = Get-HoloAssistantRoot
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend\my-app"
$dockerDir = Join-Path $rootDir "docker"
$backendEnvPath = Join-Path $backendDir ".env"
$frontendEnvPath = Join-Path $frontendDir ".env"
$voskArchive = Join-Path $frontendDir "public\models\$HoloAssistantVoskModelArchiveName"
$piperVoiceModel = Join-Path $backendDir "app\services\voice_models\$HoloAssistantPiperDefaultVoiceModelFilename"
$piperVoiceConfig = Join-Path $backendDir "app\services\voice_models\$HoloAssistantPiperDefaultVoiceConfigFilename"

Write-Host "========================================"
Write-Host "   HOLO-ASSISTANT - Start Windows"
Write-Host "========================================"
Write-Host ""
if ($CheckOnly) {
    Write-HoloAssistantInfo "Modalita CheckOnly: nessun container, download, installazione o server verra' avviato."
}

if (Test-HoloAssistantNeedsWindowsAdminForDockerBootstrap -CheckOnly:$CheckOnly) {
    Write-HoloAssistantWarn "Per completare la preparazione Docker via WSL servono privilegi amministrativi."
    Write-HoloAssistantInfo "Richiedo i permessi ora, poi lo start continua solo nella finestra elevata."
    Start-HoloAssistantScriptElevated -ScriptPath $PSCommandPath
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

    $ip = Get-HoloAssistantLocalIp
    Write-HoloAssistantInfo "IP del server: $ip"

    Write-HoloAssistantStep "[1/3] Verifica prerequisiti e avvio servizi Docker..."
    Ensure-HoloAssistantDocker -CheckOnly:$CheckOnly
    $databaseHost = Get-HoloAssistantDatabaseHost
    Write-HoloAssistantInfo "Host database iniziale in configurazione: $databaseHost"
    $python = Get-HoloAssistantPythonCommand -CheckOnly:$CheckOnly
    Write-HoloAssistantOk "Python disponibile: $($python.Exe) $($python.Args -join ' ')"
    Ensure-HoloAssistantCommand -CommandName "node" -DisplayName "Node.js" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null
    Ensure-HoloAssistantCommand -CommandName "npm" -DisplayName "npm" -PackageId "OpenJS.NodeJS.LTS" -CheckOnly:$CheckOnly | Out-Null
    $cert = Ensure-HoloAssistantHttpsCertificate -RootDir $rootDir -Ip $ip -CheckOnly:$CheckOnly

    $ollamaConfig = Get-HoloAssistantOllamaConfig -BackendEnvPath $backendEnvPath
    $ollamaRuntime = Get-HoloAssistantOllamaRuntime -Config $ollamaConfig -CheckOnly:$CheckOnly
    $wslStatus = Get-HoloAssistantWslStatus
    $dockerMode = if ($env:HOLO_ASSISTANT_DOCKER_MODE) { $env:HOLO_ASSISTANT_DOCKER_MODE } else { "non pronto" }

    if ($CheckOnly) {
        Write-HoloAssistantInfo "CheckOnly: runtime Ollama previsto: $(if ($ollamaRuntime.UseNative) { 'native' } else { 'docker' })"
        Write-HoloAssistantInfo "CheckOnly: stato WSL2: $($wslStatus.Summary)"
        Write-HoloAssistantInfo "CheckOnly: Docker effettivo: $dockerMode"
        Write-HoloAssistantInfo "CheckOnly: Ollama nativo disponibile: $([bool](Test-HoloAssistantCommand 'ollama'))"
        Write-HoloAssistantInfo "CheckOnly: Piper presente: $([bool]((Test-Path $piperVoiceModel) -and (Test-Path $piperVoiceConfig)))"
        Write-HoloAssistantInfo "CheckOnly: Vosk presente: $([bool](Test-Path $voskArchive))"
        Write-HoloAssistantInfo "CheckOnly: venv presente: $([bool](Test-Path (Join-Path $backendDir "venv")))"
        Write-HoloAssistantInfo "CheckOnly: node_modules presente: $([bool](Test-Path (Join-Path $frontendDir "node_modules")))"
        Write-HoloAssistantInfo "CheckOnly completato: start.ps1 e configurazione base sono leggibili."
        exit 0
    }

    if (-not (Test-Path $backendEnvPath)) {
        Write-HoloAssistantWarn "backend\.env non trovato: creo configurazione minima come setup."
        New-HoloAssistantBackendEnv -Path $backendEnvPath -Ip $ip -OllamaConfig $ollamaConfig -DatabaseHost $databaseHost
    }
    $databasePasswordLine = Select-String -Path $backendEnvPath -Pattern "^DATABASE_PASSWORD=" | Select-Object -First 1
    if ($databasePasswordLine) {
        $env:DATABASE_PASSWORD = $databasePasswordLine.Line.Split("=", 2)[1]
    }

    Write-HoloAssistantInfo "Rimuovo eventuale container Ollama legacy se presente..."
    Invoke-HoloAssistantDocker -Arguments @("rm", "-f", "holo_assistant_ollama") -FailureMessage "Rimozione container Ollama residuo fallita." -AllowFailure | Out-Null
    Write-HoloAssistantInfo "Avvio o riallineo i servizi Docker richiesti: postgres e adminer..."
    Invoke-HoloAssistantDocker -Arguments @("compose", "-f", "docker-compose.yml", "up", "-d", "postgres", "adminer") -WorkingDirectory $dockerDir -FailureMessage "Avvio PostgreSQL/Adminer fallito."
    Write-HoloAssistantInfo "Attendo l'inizializzazione dei container..."
    Start-Sleep -Seconds 4
    if (-not (Wait-HoloAssistantPostgresHealthy -MaxAttempts 40)) {
        Show-HoloAssistantPostgresDiagnostics -DockerDir $dockerDir
        throw "Il container PostgreSQL non e diventato healthy."
    }
    if (-not (Wait-HoloAssistantPostgres -MaxAttempts 20)) {
        Show-HoloAssistantPostgresDiagnostics -DockerDir $dockerDir
        throw "PostgreSQL non e pronto nel container."
    }
    $databaseHost = Resolve-HoloAssistantReachableDatabaseHost -Port 5432
    Write-HoloAssistantInfo "Host database effettivo selezionato: $databaseHost"

    Set-HoloAssistantEnvValues -Path $backendEnvPath -Values @{
        "DATABASE_HOST" = $databaseHost
        "ALLOWED_ORIGINS" = "https://localhost:$HoloAssistantDefaultFrontendPort,https://$ip`:$HoloAssistantDefaultFrontendPort"
        "REFRESH_TOKEN_COOKIE_SECURE" = "true"
        "REFRESH_TOKEN_COOKIE_SAMESITE" = "lax"
    }
    Write-HoloAssistantOk "Impostazioni HTTPS backend aggiornate."

    Ensure-HoloAssistantOllamaModel -Config $ollamaConfig -Runtime $ollamaRuntime
    Invoke-HoloAssistantOllamaWarmup -Config $ollamaConfig

    Write-HoloAssistantStep "[2/3] Riparazione minima e avvio backend..."
    $venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        Write-HoloAssistantWarn "Ambiente virtuale backend mancante: provo a ricrearlo."
        Ensure-HoloAssistantBackendDependencies -BackendDir $backendDir -Python $python
    } else {
        Write-HoloAssistantOk "Ambiente virtuale backend presente."
    }

    Ensure-HoloAssistantPiperVoiceModel -RootDir $rootDir -BackendDir $backendDir

    $venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
    if (Test-Path (Join-Path $backendDir "scripts\seed_categories.py")) {
        Write-HoloAssistantInfo "Riallineamento knowledge base tecnica..."
        $seedExit = Invoke-HoloAssistantTool -FilePath $venvPython -Arguments @("scripts\seed_categories.py") -WorkingDirectory $backendDir
        if ($seedExit -ne 0) {
            Write-HoloAssistantWarn "Riallineamento knowledge base non completato."
        } else {
            Write-HoloAssistantOk "Knowledge base riallineata."
        }
    }

    $backendCommand = "cd /d `"$backendDir`" && call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port $HoloAssistantDefaultBackendPort --ssl-certfile `"$($cert.CertFile)`" --ssl-keyfile `"$($cert.KeyFile)`" --no-use-colors"
    Write-HoloAssistantInfo "Apro una nuova finestra per il backend FastAPI..."
    Start-HoloAssistantCmdWindow -Title "Holo-Assistant Backend" -Command $backendCommand
    Write-HoloAssistantOk "Backend avviato su https://$ip`:$HoloAssistantDefaultBackendPort"

    Write-HoloAssistantInfo "Attendo qualche secondo prima di aprire il frontend..."
    Start-Sleep -Seconds 5

    Write-HoloAssistantStep "[3/3] Riparazione minima e avvio frontend..."
    if (-not (Test-Path $voskArchive)) {
        Write-HoloAssistantInfo "Modello Vosk mancante: provo a prepararlo."
        $voskExit = Invoke-HoloAssistantTool -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $rootDir "scripts\windows\prepare_vosk_model.ps1"))
        if ($voskExit -ne 0) {
            Write-HoloAssistantWarn "Impossibile preparare il modello Vosk automaticamente."
        } else {
            Write-HoloAssistantOk "Modello Vosk pronto."
        }
    } else {
        Write-HoloAssistantOk "Modello Vosk gia' presente."
    }

    Set-Content -Path $frontendEnvPath -Value @(
        "VITE_API_URL=https://$ip`:$HoloAssistantDefaultBackendPort",
        "VITE_VOSK_MODEL_URL=$HoloAssistantVoskModelPublicUrl"
    ) -Encoding ascii
    Write-HoloAssistantOk "frontend\my-app\.env aggiornato."

    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        Write-HoloAssistantWarn "node_modules mancante: provo a reinstallare le dipendenze frontend."
        Ensure-HoloAssistantFrontendDependencies -FrontendDir $frontendDir
    } else {
        Write-HoloAssistantOk "Dipendenze Node.js gia' installate."
    }

    $frontendCommand = "cd /d `"$frontendDir`" && npm run dev -- --host 0.0.0.0"
    Write-HoloAssistantInfo "Apro una nuova finestra per il frontend Vite..."
    Start-HoloAssistantCmdWindow -Title "Holo-Assistant Frontend" -Command $frontendCommand
    Write-HoloAssistantOk "Frontend avviato su https://$ip`:$HoloAssistantDefaultFrontendPort"

    Write-Host ""
    Write-Host "========================================"
    Write-Host "   [OK] SERVIZI AVVIATI"
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Apri il frontend da qui:"
    Write-Host "   - Locale: https://localhost:$HoloAssistantDefaultFrontendPort"
    Write-Host "   - Rete:   https://$ip`:$HoloAssistantDefaultFrontendPort"
    Write-Host ""
    Write-Host "Link tecnici:"
    Write-Host "   - Backend API: https://$ip`:$HoloAssistantDefaultBackendPort"
    Write-Host "   - API Docs:    https://$ip`:$HoloAssistantDefaultBackendPort/docs"
    Write-Host "   - Adminer DB:  http://localhost:8080"
    Write-Host ""
    Write-Host "[INFO] In sviluppo le chiamate API passano dal frontend tramite proxy Vite."
    Write-Host "[INFO] Su browser desktop o mobile di solito basta accettare il certificato del frontend."
    Write-Host "[INFO] Se apri il backend direttamente e il browser lo blocca, accetta anche: https://$ip`:$HoloAssistantDefaultBackendPort/health"
    Write-Host ""
    Write-Host "Per fermare il sistema, chiudi le finestre del terminale oppure esegui: cd docker && docker compose down"
} catch {
    Write-HoloAssistantError $_.Exception.Message
    exit 1
}
