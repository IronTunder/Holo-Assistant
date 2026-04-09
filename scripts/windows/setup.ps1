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
Write-Host "   DITTO - Setup Windows"
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

    Write-DittoStep "[1/5] Verifica prerequisiti e HTTPS..."
    Ensure-DittoDocker -CheckOnly:$CheckOnly
    $python = Get-DittoPythonCommand -CheckOnly:$CheckOnly
    Write-DittoOk "Python disponibile: $($python.Exe) $($python.Args -join ' ')"
    Ensure-DittoFrontendDependencies -FrontendDir $frontendDir -CheckOnly:$CheckOnly
    $cert = Ensure-DittoHttpsCertificate -RootDir $rootDir -Ip $ip -CheckOnly:$CheckOnly

    $ollamaConfig = Get-DittoOllamaConfig -BackendEnvPath $backendEnvPath
    $ollamaRuntime = Get-DittoOllamaRuntime -Config $ollamaConfig -CheckOnly:$CheckOnly

    if ($CheckOnly) {
        Write-DittoInfo "CheckOnly: runtime Ollama previsto: $(if ($ollamaRuntime.UseNative) { 'native' } else { 'docker' })"
        Write-DittoInfo "CheckOnly completato: setup.ps1 e configurazione base sono leggibili."
        exit 0
    }

    New-DittoBackendEnv -Path $backendEnvPath -Ip $ip -OllamaConfig $ollamaConfig
    $databasePasswordLine = Select-String -Path $backendEnvPath -Pattern "^DATABASE_PASSWORD=" | Select-Object -First 1
    if ($databasePasswordLine) {
        $env:DATABASE_PASSWORD = $databasePasswordLine.Line.Split("=", 2)[1]
    }

    Write-DittoStep "[2/5] Avvio PostgreSQL e Ollama..."
    Invoke-DittoDocker -Arguments @("compose", "-f", "docker-compose.yml", "down") -WorkingDirectory $dockerDir -FailureMessage "docker compose down fallito."
    if ($ollamaRuntime.UseNative) {
        Invoke-DittoDocker -Arguments @("compose", "-f", "docker-compose.yml", "up", "-d", "postgres", "adminer") -WorkingDirectory $dockerDir -FailureMessage "Avvio PostgreSQL/Adminer fallito."
    } else {
        Invoke-DittoDocker -Arguments (@("compose") + $ollamaRuntime.ComposeArgs + @("up", "-d")) -WorkingDirectory $dockerDir -FailureMessage "Avvio stack Docker fallito."
    }
    Start-Sleep -Seconds 8
    Wait-DittoPostgres -MaxAttempts 30 | Out-Null
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
    Start-DittoCmdWindow -Title "DITTO Backend" -Command $backendCommand
    Write-DittoOk "Backend avviato su https://$ip`:$DittoDefaultBackendPort"

    Start-Sleep -Seconds 5
    $frontendCommand = "cd /d `"$frontendDir`" && npm run dev -- --host 0.0.0.0"
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
