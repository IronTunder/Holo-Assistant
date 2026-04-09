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
Write-Host "   DITTO - Setup Windows"
Write-Host "========================================"
Write-Host ""
if ($CheckOnly) {
    Write-DittoInfo "Modalita CheckOnly: nessun container, download, installazione o server verra' avviato."
}

if (Test-DittoNeedsWindowsAdminForDockerBootstrap -CheckOnly:$CheckOnly) {
    Write-DittoWarn "Per completare il setup Docker via WSL servono privilegi amministrativi."
    Write-DittoInfo "Richiedo i permessi ora, poi il setup continua solo nella finestra elevata."
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

    Write-DittoStep "[1/5] Verifica prerequisiti e HTTPS..."
    Ensure-DittoDocker -CheckOnly:$CheckOnly
    $databaseHost = Get-DittoDatabaseHost
    Write-DittoInfo "Host database iniziale in configurazione: $databaseHost"
    $python = Get-DittoPythonCommand -CheckOnly:$CheckOnly
    Write-DittoOk "Python disponibile: $($python.Exe) $($python.Args -join ' ')"
    Ensure-DittoFrontendDependencies -FrontendDir $frontendDir -CheckOnly:$CheckOnly
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
        Write-DittoInfo "CheckOnly: venv presente: $([bool](Test-Path (Join-Path $backendDir 'venv')))"
        Write-DittoInfo "CheckOnly: node_modules presente: $([bool](Test-Path (Join-Path $frontendDir 'node_modules')))"
        Write-DittoInfo "CheckOnly completato: setup.ps1 e configurazione base sono leggibili."
        exit 0
    }

    New-DittoBackendEnv -Path $backendEnvPath -Ip $ip -OllamaConfig $ollamaConfig -DatabaseHost $databaseHost
    $databasePasswordLine = Select-String -Path $backendEnvPath -Pattern "^DATABASE_PASSWORD=" | Select-Object -First 1
    if ($databasePasswordLine) {
        $env:DATABASE_PASSWORD = $databasePasswordLine.Line.Split("=", 2)[1]
    }

    Write-DittoStep "[2/5] Avvio PostgreSQL e Ollama..."
    Write-DittoInfo "Arresto eventuali servizi Docker residui del progetto..."
    Invoke-DittoDocker -Arguments @("compose", "-f", "docker-compose.yml", "down") -WorkingDirectory $dockerDir -FailureMessage "docker compose down fallito."
    Write-DittoInfo "Rimuovo eventuale container Ollama legacy se presente..."
    Invoke-DittoDocker -Arguments @("rm", "-f", "ditto_ollama") -FailureMessage "Rimozione container Ollama residuo fallita." -AllowFailure | Out-Null
    Write-DittoInfo "Avvio i servizi Docker richiesti dal progetto: postgres e adminer..."
    Invoke-DittoDocker -Arguments @("compose", "-f", "docker-compose.yml", "up", "-d", "postgres", "adminer") -WorkingDirectory $dockerDir -FailureMessage "Avvio PostgreSQL/Adminer fallito."
    Write-DittoInfo "Attendo l'inizializzazione dei container..."
    Start-Sleep -Seconds 8
    if (-not (Wait-DittoPostgres -MaxAttempts 30)) {
        Show-DittoPostgresDiagnostics -DockerDir $dockerDir
        throw "PostgreSQL non e pronto nel container."
    }
    $databaseHost = Resolve-DittoReachableDatabaseHost -Port 5432
    Write-DittoInfo "Host database effettivo selezionato: $databaseHost"
    Set-DittoEnvValues -Path $backendEnvPath -Values @{
        "DATABASE_HOST" = $databaseHost
    }
    Ensure-DittoOllamaModel -Config $ollamaConfig -Runtime $ollamaRuntime

    Write-DittoStep "[3/5] Configurazione backend e database..."
    Write-DittoOk "backend\.env creato."
    $adminPasswordLine = Select-String -Path $backendEnvPath -Pattern "^ADMIN_PASSWORD=" | Select-Object -First 1
    if ($adminPasswordLine) {
        Write-DittoInfo "Credenziali admin iniziali: admin / $($adminPasswordLine.Line.Split("=", 2)[1])"
    }

    Ensure-DittoBackendDependencies -BackendDir $backendDir -Python $python
    $venvPython = Join-Path $backendDir "venv\Scripts\python.exe"

    if (Test-Path (Join-Path $backendDir "scripts\init_db.py")) {
        Write-DittoInfo "Creo tabelle database..."
        Invoke-DittoToolChecked -FilePath $venvPython -Arguments @("scripts\init_db.py") -WorkingDirectory $backendDir -FailureMessage "init_db.py fallito."
    } else {
        Write-DittoWarn "scripts\init_db.py non trovato."
    }

    if (Test-Path (Join-Path $backendDir "scripts\populate.py")) {
        Write-DittoInfo "Popolo database con dati dimostrativi per verifica setup..."
        $previousDemoSeed = $env:DITTO_ALLOW_DEMO_SEED
        $env:DITTO_ALLOW_DEMO_SEED = "true"
        try {
            Invoke-DittoToolChecked -FilePath $venvPython -Arguments @("scripts\populate.py") -WorkingDirectory $backendDir -FailureMessage "populate.py fallito."
        } finally {
            if ($null -eq $previousDemoSeed) {
                Remove-Item Env:\DITTO_ALLOW_DEMO_SEED -ErrorAction SilentlyContinue
            } else {
                $env:DITTO_ALLOW_DEMO_SEED = $previousDemoSeed
            }
        }
    } else {
        Write-DittoWarn "scripts\populate.py non trovato."
    }

    if (Test-Path (Join-Path $backendDir "scripts\seed_categories.py")) {
        Write-DittoInfo "Seed categorie e risposte per AI..."
        Invoke-DittoToolChecked -FilePath $venvPython -Arguments @("scripts\seed_categories.py") -WorkingDirectory $backendDir -FailureMessage "seed_categories.py fallito."
    } else {
        Write-DittoWarn "scripts\seed_categories.py non trovato."
    }

    Ensure-DittoPiperVoiceModel -RootDir $rootDir -BackendDir $backendDir

    Write-DittoStep "[4/5] Configurazione frontend..."
    if (-not (Test-Path $voskArchive)) {
        Write-DittoInfo "Preparo modello wake-word Vosk..."
        Invoke-DittoToolChecked -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $rootDir "scripts\windows\prepare_vosk_model.ps1")) -FailureMessage "Preparazione modello Vosk fallita."
    } else {
        Write-DittoOk "Modello Vosk gia' presente."
    }

    Set-Content -Path $frontendEnvPath -Value @(
        "VITE_API_URL=https://$ip`:$DittoDefaultBackendPort",
        "VITE_VOSK_MODEL_URL=$DittoVoskModelPublicUrl"
    ) -Encoding ascii
    Write-DittoOk "frontend\my-app\.env creato."
    Ensure-DittoFrontendDependencies -FrontendDir $frontendDir

    Write-DittoStep "[5/5] Avvio backend e frontend..."
    $backendCommand = "cd /d `"$backendDir`" && call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port $DittoDefaultBackendPort --ssl-certfile `"$($cert.CertFile)`" --ssl-keyfile `"$($cert.KeyFile)`" --no-use-colors"
    Write-DittoInfo "Apro una nuova finestra per il backend FastAPI..."
    Start-DittoCmdWindow -Title "DITTO Backend" -Command $backendCommand
    Write-DittoOk "Backend avviato su https://$ip`:$DittoDefaultBackendPort"

    Write-DittoInfo "Attendo qualche secondo prima di aprire il frontend..."
    Start-Sleep -Seconds 5
    $frontendCommand = "cd /d `"$frontendDir`" && npm run dev -- --host 0.0.0.0"
    Write-DittoInfo "Apro una nuova finestra per il frontend Vite..."
    Start-DittoCmdWindow -Title "DITTO Frontend" -Command $frontendCommand
    Write-DittoOk "Frontend avviato su https://$ip`:$DittoDefaultFrontendPort"

    Write-Host ""
    Write-Host "========================================"
    Write-Host "   [OK] SISTEMA AVVIATO CON SUCCESSO!"
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
    Write-Host "Credenziali di test:"
    Write-Host "   - Username: Mario Rossi / Luigi Verdi / Anna Bianchi / Marco Neri"
    Write-Host "   - Password: password123"
    Write-Host ""
    Write-Host "[INFO] In sviluppo le chiamate API passano dal frontend tramite proxy Vite."
    Write-Host "[INFO] Su browser desktop o mobile di solito basta accettare il certificato del frontend."
    Write-Host "[INFO] Se apri il backend direttamente e il browser lo blocca, accetta anche: https://$ip`:$DittoDefaultBackendPort/health"
    Write-Host ""
    Write-Host "Per fermare il sistema, chiudi le finestre del terminale o premi Ctrl+C."
    Write-Host "========================================"
    pause
} catch {
    Write-DittoError $_.Exception.Message
    exit 1
}
