@echo off
title DITTO Setup - Avvio del sistema

echo ========================================
echo    DITTO - Avvio del sistema
echo ========================================
echo.

:: Salva la directory corrente (root del progetto)
set SCRIPT_DIR=%~dp0
for %%I in ("%SCRIPT_DIR%..\..") do set ROOT_DIR=%%~fI
set OLLAMA_MODEL=qwen3.5:9b
set OLLAMA_BASE_URL=http://127.0.0.1:11434
set OLLAMA_RUNTIME=auto
set OLLAMA_ACCELERATOR=auto
set OLLAMA_COMPOSE_ARGS=-f docker-compose.yml
set OLLAMA_USE_NATIVE=false
set OLLAMA_NATIVE_VULKAN=1

:: Ottieni l'IP locale
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| find "IPv4"') do (
    set IP=%%a
    goto :ip_found
)
:ip_found
set IP=%IP: =%
echo [INFO] IP del server: %IP%
echo.

:: 1. Avvia Docker
echo [1/5] Avvio PostgreSQL e Ollama con Docker...
cd %ROOT_DIR%\docker
if not exist docker-compose.yml (
    echo [ERRORE] File docker-compose.yml non trovato in %CD%
    pause
    exit /b 1
)

call :resolve_ollama_runtime
if errorlevel 1 exit /b 1

:: Ferma container esistenti e riavvia
docker compose -f docker-compose.yml down 2>nul
if /I "%OLLAMA_USE_NATIVE%"=="true" (
    docker compose -f docker-compose.yml up -d postgres adminer
) else (
    docker compose %OLLAMA_COMPOSE_ARGS% up -d
)
if errorlevel 1 (
    echo [ERRORE] Impossibile avviare Docker. Assicurati che Docker Desktop sia in esecuzione.
    pause
    exit /b 1
)
echo [OK] Docker avviato correttamente
echo.

:: Attendi che PostgreSQL sia pronto
echo Attendendo l'avvio di PostgreSQL e Ollama...
timeout /t 8 /nobreak >nul

:: Verifica che PostgreSQL sia pronto
echo Verifica connessione a PostgreSQL...
set MAX_ATTEMPTS=30
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

:: Verifica che Ollama sia pronto e pull il modello qwen3.5:9b
echo Preparazione modello AI (%OLLAMA_MODEL%)...
if /I "%OLLAMA_USE_NATIVE%"=="true" (
    where ollama >nul 2>&1
    if errorlevel 1 (
        echo [ERRORE] Ollama nativo non trovato. Installa Ollama per Windows oppure imposta OLLAMA_RUNTIME=docker.
        pause
        exit /b 1
    )
    call :ensure_native_ollama
    ollama pull %OLLAMA_MODEL% >nul 2>&1
    if errorlevel 1 (
        echo [AVVISO] Impossibile pullare il modello %OLLAMA_MODEL% con Ollama nativo.
        echo [AVVISO] Puoi pullare manualmente con: ollama pull %OLLAMA_MODEL%
    ) else (
        echo [OK] Modello %OLLAMA_MODEL% pronto su Ollama nativo
    )
) else (
    docker exec ditto_ollama ollama pull %OLLAMA_MODEL% >nul 2>&1
    if errorlevel 1 (
        echo [AVVISO] Impossibile pullare il modello %OLLAMA_MODEL%. Assicurati che Ollama sia accessibile.
        echo [AVVISO] Puoi pullare manualmente con: docker exec ditto_ollama ollama pull %OLLAMA_MODEL%
    ) else (
        echo [OK] Modello %OLLAMA_MODEL% pronto nel container
    )
)
echo.

:: 2. Configura il backend
echo [2/5] Configurazione backend...
cd %ROOT_DIR%

:: Crea .env per backend
(
echo DATABASE_HOST=%IP%
echo DATABASE_PORT=5432
echo DATABASE_USER=postgres
echo DATABASE_PASSWORD=postgres
echo DATABASE_NAME=ditto_db
echo SECRET_KEY=your-super-secret-key-change-this-in-production
echo ADMIN_USERNAME=admin
echo ADMIN_PASSWORD=tuapasswordsicura
echo ACCESS_TOKEN_EXPIRE_MINUTES=480
echo ADMIN_TOKEN_EXPIRE_MINUTES=120
echo OPERATOR_REFRESH_TOKEN_EXPIRE_MINUTES=480
echo ADMIN_REFRESH_TOKEN_EXPIRE_MINUTES=120
echo ALGORITHM=HS256
echo ALLOWED_ORIGINS=http://localhost:5173,http://%IP%:5173
echo OLLAMA_BASE_URL=http://127.0.0.1:11434
echo OLLAMA_MODEL=qwen3.5:9b
echo OLLAMA_RUNTIME=%OLLAMA_RUNTIME%
echo OLLAMA_ACCELERATOR=%OLLAMA_ACCELERATOR%
echo OLLAMA_NATIVE_VULKAN=%OLLAMA_NATIVE_VULKAN%
echo OLLAMA_TIMEOUT_SECONDS=120
echo OLLAMA_HEALTH_TIMEOUT_SECONDS=5
echo OLLAMA_KEEP_ALIVE=30m
echo OLLAMA_NUM_PREDICT_CLASSIFY=4
echo OLLAMA_NUM_PREDICT_SELECT=2
echo OLLAMA_NUM_PREDICT_RERANK=12
echo OLLAMA_TOP_K=20
echo OLLAMA_TOP_P=0.8
echo OLLAMA_TEMPERATURE_CLASSIFY=0.0
echo OLLAMA_TEMPERATURE_SELECT=0.0
echo OLLAMA_NUM_CTX=2048
echo OLLAMA_NUM_THREAD=4
echo TTS_ENABLED=true
) > %ROOT_DIR%\backend\.env
echo [OK] Backend configurato
echo.

:: 3. Crea e popola il database
echo [3/5] Configurazione database...
cd %ROOT_DIR%\backend

:: Verifica che siamo nella directory giusta
echo Directory corrente: %CD%

:: Attiva ambiente virtuale se esiste, altrimenti crealo
if not exist venv\ (
    echo Creazione ambiente virtuale...
    python -m venv venv
)

:: Attiva ambiente virtuale
call venv\Scripts\activate.bat

:: Aggiorna pip
echo Aggiornamento pip...
python -m pip install --upgrade pip --quiet

:: Installa dipendenze
echo Installazione dipendenze Python...
if exist requirements.txt (
    pip install -r requirements.txt --quiet
) else (
    echo [AVVISO] requirements.txt non trovato, installo dipendenze base
    pip install fastapi uvicorn sqlalchemy psycopg2-binary python-jose[cryptography] passlib[bcrypt] python-multipart python-dotenv requests --quiet
)

:: Crea tabelle
if exist scripts\init_db.py (
    echo Creazione tabelle database...
    python scripts\init_db.py
) else (
    echo [AVVISO] scripts\init_db.py non trovato
)

:: Popola database con dati di test
if exist scripts\populate.py (
    echo Popolamento database con dati di test...
    python scripts\populate.py
) else (
    echo [AVVISO] scripts\populate.py non trovato
)

:: Popola database con categorie e risposte preset per Ollama
if exist scripts\seed_categories.py (
    echo Seeding categorie e risposte per AI...
    python scripts\seed_categories.py
) else (
    echo [AVVISO] scripts\seed_categories.py non trovato
)

echo [OK] Database configurato
echo.

:: 4. Avvia backend
echo [4/5] Avvio backend FastAPI...
start "DITTO Backend" cmd /k "cd /d %ROOT_DIR%\backend && call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --no-use-colors"
echo [OK] Backend avviato su http://%IP%:8000
echo.

:: Attendi che il backend sia pronto
echo Attendendo l'avvio del backend...
timeout /t 5 /nobreak >nul

:: 5. Configura e avvia frontend
echo [5/5] Configurazione e avvio frontend...
cd %ROOT_DIR%\frontend\my-app

:: Verifica che siamo nella directory giusta
echo Directory corrente: %CD%

:: Crea .env per frontend
(
echo VITE_API_URL=http://%IP%:8000
) > .env

:: Installa dipendenze se necessario
if not exist node_modules\ (
    echo Installazione dipendenze Node.js...
    call npm install
) else (
    echo Dipendenze Node.js gia' installate
)

:: Avvia frontend
echo Avvio frontend...
start "DITTO Frontend" cmd /k "cd /d %ROOT_DIR%\frontend\my-app && npm run dev -- --host 0.0.0.0"

echo [OK] Frontend avviato su http://%IP%:5173
echo.

:: Torna alla directory root
cd %ROOT_DIR%

:: Mostra riepilogo
echo ========================================
echo    [OK] SISTEMA AVVIATO CON SUCCESSO!
echo ========================================
echo.
echo Accesso dal computer locale:
echo    - Frontend: http://localhost:5173
echo    - Backend API: http://localhost:8000
echo    - Documentazione API: http://localhost:8000/docs
echo    - Adminer DB: http://localhost:8080
echo.
echo Accesso da altri dispositivi (stessa rete):
echo    - Frontend: http://%IP%:5173
echo    - Backend API: http://%IP%:8000
echo.
echo Credenziali di test:
echo    - Username: Mario Rossi / Luigi Verdi / Anna Bianchi / Marco Neri
echo    - Password: password123
echo.
echo Per fermare il sistema, chiudi le finestre del terminale
echo o premi Ctrl+C in ogni finestra.
echo.
echo ========================================
echo.

pause
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
        if /I "%%A"=="OLLAMA_RUNTIME" set OLLAMA_RUNTIME=%%B
        if /I "%%A"=="OLLAMA_ACCELERATOR" set OLLAMA_ACCELERATOR=%%B
        if /I "%%A"=="OLLAMA_NATIVE_VULKAN" set OLLAMA_NATIVE_VULKAN=%%B
        if /I "%%A"=="OLLAMA_VULKAN" set OLLAMA_NATIVE_VULKAN=%%~B
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
