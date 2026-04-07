@echo off
title DITTO Start - Avvio servizi

echo ========================================
echo    DITTO - Avvio servizi
echo ========================================
echo.

set SCRIPT_DIR=%~dp0
for %%I in ("%SCRIPT_DIR%..\..") do set ROOT_DIR=%%~fI
set BACKEND_PORT=8000
set FRONTEND_PORT=5173
set CERT_FILE=%ROOT_DIR%\certs\ditto.crt
set KEY_FILE=%ROOT_DIR%\certs\ditto.key
set OLLAMA_MODEL=qwen3.5:9b
set OLLAMA_BASE_URL=http://127.0.0.1:11434
set OLLAMA_KEEP_ALIVE=30m
set OLLAMA_TOP_K=20
set OLLAMA_TOP_P=0.8
set OLLAMA_NUM_CTX=2048
set OLLAMA_NUM_THREAD=4
set OLLAMA_RUNTIME=auto
set OLLAMA_ACCELERATOR=auto
set OLLAMA_COMPOSE_ARGS=-f docker-compose.yml
set OLLAMA_USE_NATIVE=false
set OLLAMA_NATIVE_VULKAN=1

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| find "IPv4"') do (
    set IP=%%a
    goto :ip_found
)
:ip_found
set IP=%IP: =%
if "%IP%"=="" set IP=localhost

echo [INFO] IP del server: %IP%
call :ensure_https_certificate
if errorlevel 1 exit /b 1
echo [INFO] HTTPS attivo con certificato: %CERT_FILE%
echo.

echo [1/3] Avvio PostgreSQL e Ollama con Docker...
cd /d %ROOT_DIR%\docker
if not exist docker-compose.yml (
    echo [ERRORE] File docker-compose.yml non trovato in %CD%
    pause
    exit /b 1
)

call :resolve_ollama_runtime
if /I "%OLLAMA_USE_NATIVE%"=="true" (
    docker compose -f docker-compose.yml stop ollama >nul 2>&1
    docker compose -f docker-compose.yml up -d postgres adminer
) else (
    docker compose %OLLAMA_COMPOSE_ARGS% up -d
)
if errorlevel 1 (
    echo [AVVISO] Impossibile avviare Docker con docker-compose.
    echo [AVVISO] Continuo comunque: assicurati che PostgreSQL e Ollama siano gia' in esecuzione.
) else (
    echo [OK] Docker avviato correttamente
)
echo.

echo Attendendo l'avvio di PostgreSQL e Ollama...
timeout /t 8 /nobreak >nul

echo Verifica connessione a PostgreSQL...
set MAX_ATTEMPTS=20
set ATTEMPT=1
:wait_postgres
docker exec ditto_postgres pg_isready -U postgres >nul 2>&1
if not errorlevel 1 (
    echo [OK] PostgreSQL e' pronto
    goto :postgres_ready
)
if %ATTEMPT% equ %MAX_ATTEMPTS% (
    echo [AVVISO] PostgreSQL potrebbe non essere pronto
    goto :postgres_ready
)
set /a ATTEMPT+=1
timeout /t 2 /nobreak >nul
goto :wait_postgres
:postgres_ready
echo.

if exist %ROOT_DIR%\backend\.env (
    for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT_DIR%\backend\.env") do (
        if /I "%%A"=="OLLAMA_MODEL" set OLLAMA_MODEL=%%B
        if /I "%%A"=="OLLAMA_BASE_URL" set OLLAMA_BASE_URL=%%B
        if /I "%%A"=="OLLAMA_KEEP_ALIVE" set OLLAMA_KEEP_ALIVE=%%B
        if /I "%%A"=="OLLAMA_TOP_K" set OLLAMA_TOP_K=%%B
        if /I "%%A"=="OLLAMA_TOP_P" set OLLAMA_TOP_P=%%B
        if /I "%%A"=="OLLAMA_NUM_CTX" set OLLAMA_NUM_CTX=%%B
        if /I "%%A"=="OLLAMA_NUM_THREAD" set OLLAMA_NUM_THREAD=%%B
        if /I "%%A"=="OLLAMA_RUNTIME" set OLLAMA_RUNTIME=%%B
        if /I "%%A"=="OLLAMA_ACCELERATOR" set OLLAMA_ACCELERATOR=%%B
        if /I "%%A"=="OLLAMA_NATIVE_VULKAN" set OLLAMA_NATIVE_VULKAN=%%B
        if /I "%%A"=="OLLAMA_VULKAN" set OLLAMA_NATIVE_VULKAN=%%~B
    )
)

powershell -NoProfile -Command "$envPath='%ROOT_DIR%\backend\.env'; $updates=@{ALLOWED_ORIGINS='https://localhost:5173,https://%IP%:%FRONTEND_PORT%'; REFRESH_TOKEN_COOKIE_SECURE='true'; REFRESH_TOKEN_COOKIE_SAMESITE='lax'}; $lines=@(); if (Test-Path $envPath) { $lines=@(Get-Content $envPath) }; foreach ($key in $updates.Keys) { $line = $key + '=' + $updates[$key]; $index = -1; for ($i=0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match ('^' + [regex]::Escape($key) + '=')) { $index=$i; break } }; if ($index -ge 0) { $lines[$index]=$line } else { $lines += $line } }; Set-Content -Path $envPath -Value $lines"
if errorlevel 1 (
    echo [AVVISO] Impossibile aggiornare automaticamente le impostazioni HTTPS in backend\.env
) else (
    echo [OK] Impostazioni HTTPS backend aggiornate
)

echo Preparazione modello AI: %OLLAMA_MODEL%
if /I "%OLLAMA_USE_NATIVE%"=="true" (
    where ollama >nul 2>&1
    if errorlevel 1 (
        echo [ERRORE] Ollama nativo non trovato. Installa Ollama per Windows oppure imposta OLLAMA_RUNTIME=docker.
        pause
        exit /b 1
    )
    call :ensure_native_ollama
    ollama list 2>nul | findstr /i /c:"%OLLAMA_MODEL%" >nul
    if errorlevel 1 (
        echo [AVVISO] Modello %OLLAMA_MODEL% non trovato in Ollama nativo
        echo [AVVISO] Esegui setup.bat oppure: ollama pull %OLLAMA_MODEL%
    ) else (
        call :warmup_ollama
    )
) else (
    docker exec ditto_ollama ollama list 2>nul | findstr /i /c:"%OLLAMA_MODEL%" >nul
    if errorlevel 1 (
        echo [AVVISO] Modello %OLLAMA_MODEL% non trovato nel container Ollama
        echo [AVVISO] Esegui setup.bat oppure: docker exec ditto_ollama ollama pull %OLLAMA_MODEL%
    ) else (
        call :warmup_ollama
    )
)
echo.

echo [2/3] Avvio backend FastAPI...
cd /d %ROOT_DIR%\backend

if not exist venv\ (
    echo [ERRORE] Ambiente virtuale non trovato in %CD%\venv
    echo [INFO] Esegui prima setup.bat
    pause
    exit /b 1
)

echo Riallineamento knowledge base tecnica...
call venv\Scripts\activate.bat
python scripts\seed_categories.py
if errorlevel 1 (
    echo [AVVISO] Riallineamento knowledge base non completato
) else (
    echo [OK] Knowledge base riallineata
)
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Python non trovato. Installa Python prima di procedere.
    pause
    exit /b 1
)

start "DITTO Backend" cmd /k "cd /d %ROOT_DIR%\backend && call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port %BACKEND_PORT% --ssl-certfile ..\certs\ditto.crt --ssl-keyfile ..\certs\ditto.key --no-use-colors"
echo [OK] Backend avviato su https://%IP%:%BACKEND_PORT%
echo.

echo Attendendo l'avvio del backend...
timeout /t 5 /nobreak >nul

echo [3/3] Avvio frontend...
cd /d %ROOT_DIR%\frontend\my-app

node --version >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato. Installa Node.js prima di procedere.
    pause
    exit /b 1
)

(
echo VITE_API_URL=https://%IP%:%BACKEND_PORT%
) > .env

if not exist node_modules\ (
    echo Installazione dipendenze Node.js...
    call npm install
    if errorlevel 1 (
        echo [ERRORE] Installazione dipendenze frontend fallita
        pause
        exit /b 1
    )
) else (
    echo Dipendenze Node.js gia' installate
)

start "DITTO Frontend" cmd /k "cd /d %ROOT_DIR%\frontend\my-app && npm run dev -- --host 0.0.0.0"
echo [OK] Frontend avviato su https://%IP%:%FRONTEND_PORT%
echo.

cd /d %ROOT_DIR%

echo ========================================
echo    [OK] SERVIZI AVVIATI
echo ========================================
echo.
echo Frontend locale: https://localhost:%FRONTEND_PORT%
echo Frontend rete:   https://%IP%:%FRONTEND_PORT%
echo Backend API:     https://%IP%:%BACKEND_PORT%
echo API Docs:        https://%IP%:%BACKEND_PORT%/docs
echo Adminer DB:      http://localhost:8080
echo.
echo [INFO] Su dispositivi mobile potrebbe comparire un avviso certificato.
echo [INFO] Se le API non rispondono, apri e accetta anche: https://%IP%:%BACKEND_PORT%/health
echo.
echo Per fermare il sistema, chiudi le finestre del terminale
echo oppure esegui: cd docker ^&^& docker-compose down
echo.

pause
goto :eof

:ensure_https_certificate
if exist "%CERT_FILE%" if exist "%KEY_FILE%" goto :eof

echo [INFO] Certificato HTTPS non trovato o incompleto. Provo a generarlo per IP %IP%...
where mkcert >nul 2>&1
if errorlevel 1 (
    echo [INFO] mkcert non trovato. Provo a installarlo con winget...
    winget install -e --id FiloSottile.mkcert --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo [ERRORE] Installazione mkcert con winget fallita.
        echo [INFO] Puoi riprovare manualmente con:
        echo        winget install -e --id FiloSottile.mkcert
        pause
        exit /b 1
    )
    where mkcert >nul 2>&1
    if errorlevel 1 (
        echo [ERRORE] mkcert installato, ma non ancora disponibile nel PATH di questa finestra.
        echo [INFO] Riapri il terminale e rilancia start.bat.
        pause
        exit /b 1
    )
)

if not exist "%ROOT_DIR%\certs" mkdir "%ROOT_DIR%\certs"
mkcert -cert-file "%CERT_FILE%" -key-file "%KEY_FILE%" %IP% localhost 127.0.0.1 ditto.lan
if errorlevel 1 (
    echo [ERRORE] Generazione certificato HTTPS fallita.
    pause
    exit /b 1
)

if not exist "%CERT_FILE%" (
    echo [ERRORE] Certificato HTTPS non creato: %CERT_FILE%
    pause
    exit /b 1
)
if not exist "%KEY_FILE%" (
    echo [ERRORE] Chiave HTTPS non creata: %KEY_FILE%
    pause
    exit /b 1
)
echo [OK] Certificato HTTPS generato per %IP%, localhost, 127.0.0.1 e ditto.lan
goto :eof

:warmup_ollama
echo [INFO] Attendo che Ollama risponda su %OLLAMA_BASE_URL%...
set MAX_OLLAMA_ATTEMPTS=30
set OLLAMA_ATTEMPT=1
:wait_ollama
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-RestMethod -Uri '%OLLAMA_BASE_URL%/api/tags' -Method Get -TimeoutSec 5 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto :ollama_ready
if %OLLAMA_ATTEMPT% equ %MAX_OLLAMA_ATTEMPTS% (
    echo [AVVISO] Ollama non risponde ancora all'endpoint /api/tags
    goto :eof
)
set /a OLLAMA_ATTEMPT+=1
timeout /t 2 /nobreak >nul
goto :wait_ollama
:ollama_ready
echo [INFO] Warmup modello AI in corso...
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; $body = '{\"model\":\"%OLLAMA_MODEL%\",\"prompt\":\"Rispondi solo OK\",\"stream\":false,\"think\":false,\"keep_alive\":\"%OLLAMA_KEEP_ALIVE%\",\"options\":{\"temperature\":0,\"top_k\":%OLLAMA_TOP_K%,\"top_p\":%OLLAMA_TOP_P%,\"num_predict\":12,\"num_ctx\":%OLLAMA_NUM_CTX%,\"num_thread\":%OLLAMA_NUM_THREAD%}}'; try { Invoke-RestMethod -Uri '%OLLAMA_BASE_URL%/api/generate' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 120 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [AVVISO] Warmup Ollama non completato. Il primo prompt potrebbe essere piu' lento.
) else (
    echo [OK] Modello AI pronto
)
goto :eof

:ensure_native_ollama
echo [INFO] Verifica server Ollama nativo su %OLLAMA_BASE_URL%...
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-RestMethod -Uri '%OLLAMA_BASE_URL%/api/tags' -Method Get -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto :eof

echo [INFO] Avvio Ollama nativo in background...
start "DITTO Ollama" cmd /k "set OLLAMA_VULKAN=%OLLAMA_NATIVE_VULKAN% && ollama serve"
set NATIVE_OLLAMA_ATTEMPT=1
set MAX_NATIVE_OLLAMA_ATTEMPTS=20
:wait_native_ollama
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-RestMethod -Uri '%OLLAMA_BASE_URL%/api/tags' -Method Get -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [OK] Ollama nativo raggiungibile
    goto :eof
)
if %NATIVE_OLLAMA_ATTEMPT% equ %MAX_NATIVE_OLLAMA_ATTEMPTS% (
    echo [AVVISO] Ollama nativo non risponde ancora su %OLLAMA_BASE_URL%
    goto :eof
)
set /a NATIVE_OLLAMA_ATTEMPT+=1
goto :wait_native_ollama

:resolve_ollama_runtime
set OLLAMA_USE_NATIVE=false
if exist %ROOT_DIR%\backend\.env (
    for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT_DIR%\backend\.env") do (
        if /I "%%A"=="OLLAMA_MODEL" set OLLAMA_MODEL=%%B
        if /I "%%A"=="OLLAMA_BASE_URL" set OLLAMA_BASE_URL=%%B
        if /I "%%A"=="OLLAMA_KEEP_ALIVE" set OLLAMA_KEEP_ALIVE=%%B
        if /I "%%A"=="OLLAMA_TOP_K" set OLLAMA_TOP_K=%%B
        if /I "%%A"=="OLLAMA_TOP_P" set OLLAMA_TOP_P=%%B
        if /I "%%A"=="OLLAMA_NUM_CTX" set OLLAMA_NUM_CTX=%%B
        if /I "%%A"=="OLLAMA_NUM_THREAD" set OLLAMA_NUM_THREAD=%%B
        if /I "%%A"=="OLLAMA_RUNTIME" set OLLAMA_RUNTIME=%%B
        if /I "%%A"=="OLLAMA_ACCELERATOR" set OLLAMA_ACCELERATOR=%%B
    )
)
if /I "%OLLAMA_RUNTIME%"=="native" (
    set OLLAMA_USE_NATIVE=true
    echo [INFO] Runtime Ollama: nativo Windows
    goto :eof
)
if /I "%OLLAMA_RUNTIME%"=="docker" goto :configure_docker_runtime

where ollama >nul 2>&1
if not errorlevel 1 (
    set OLLAMA_USE_NATIVE=true
    echo [INFO] Runtime Ollama auto: uso Ollama nativo su Windows
    goto :eof
)

:configure_docker_runtime
set OLLAMA_COMPOSE_ARGS=-f docker-compose.yml
if /I "%OLLAMA_ACCELERATOR%"=="nvidia" (
    set OLLAMA_COMPOSE_ARGS=-f docker-compose.yml -f docker-compose.nvidia.yml
    echo [INFO] Accelerazione Ollama Docker: NVIDIA
    goto :eof
)
if /I "%OLLAMA_ACCELERATOR%"=="amd" (
    echo [AVVISO] GPU AMD in Docker e' supportata soprattutto su host Linux/WSL con ROCm.
    echo [AVVISO] Su Windows e' consigliato Ollama nativo per usare la GPU AMD.
    set OLLAMA_COMPOSE_ARGS=-f docker-compose.yml -f docker-compose.amd.yml
    goto :eof
)
echo [INFO] Runtime Ollama: Docker CPU/default
goto :eof
