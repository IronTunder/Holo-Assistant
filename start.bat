@echo off
title DITTO Start - Avvio servizi

echo ========================================
echo    DITTO - Avvio servizi
echo ========================================
echo.

set ROOT_DIR=%CD%
set BACKEND_PORT=8000
set FRONTEND_PORT=5173
set OLLAMA_MODEL=mistral:7b-instruct-v0.3-q4_K_M

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| find "IPv4"') do (
    set IP=%%a
    goto :ip_found
)
:ip_found
set IP=%IP: =%
if "%IP%"=="" set IP=localhost

echo [INFO] IP del server: %IP%
echo.

echo [1/3] Avvio PostgreSQL e Ollama con Docker...
cd /d %ROOT_DIR%\docker
if not exist docker-compose.yml (
    echo [ERRORE] File docker-compose.yml non trovato in %CD%
    pause
    exit /b 1
)

docker-compose down 2>nul
docker-compose up -d
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
    )
)

echo Preparazione modello AI: %OLLAMA_MODEL%
docker exec ditto_ollama ollama list 2>nul | findstr /i /c:"%OLLAMA_MODEL%" >nul
if errorlevel 1 (
    echo [AVVISO] Modello %OLLAMA_MODEL% non trovato nel container Ollama
    echo [AVVISO] Esegui setup.bat oppure: docker exec ditto_ollama ollama pull %OLLAMA_MODEL%
) else (
    echo [INFO] Warmup modello AI in corso...
    docker exec ditto_ollama ollama run %OLLAMA_MODEL% "Rispondi solo OK" >nul 2>&1
    if errorlevel 1 (
        echo [AVVISO] Warmup Ollama non completato. Il primo prompt potrebbe essere piu' lento.
    ) else (
        echo [OK] Modello AI pronto
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

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Python non trovato. Installa Python prima di procedere.
    pause
    exit /b 1
)

start "DITTO Backend" cmd /k "cd /d %ROOT_DIR%\backend && call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port %BACKEND_PORT% --no-use-colors"
echo [OK] Backend avviato su http://%IP%:%BACKEND_PORT%
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
echo VITE_API_URL=http://%IP%:%BACKEND_PORT%
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
echo [OK] Frontend avviato su http://%IP%:%FRONTEND_PORT%
echo.

cd /d %ROOT_DIR%

(
echo === DITTO - Informazioni di sistema ===
echo Data avvio: %date% %time%
echo IP Server: %IP%
echo.
echo URL:
echo - Frontend locale: http://localhost:%FRONTEND_PORT%
echo - Frontend rete: http://%IP%:%FRONTEND_PORT%
echo - Backend: http://%IP%:%BACKEND_PORT%
echo - API Docs: http://%IP%:%BACKEND_PORT%/docs
echo.
echo Comandi utili:
echo - Ferma container: cd docker ^&^& docker-compose down
echo - Log container: docker-compose logs -f
echo.
) > %ROOT_DIR%\ditto_info.txt
echo [OK] Informazioni salvate in: %ROOT_DIR%\ditto_info.txt
echo.

echo ========================================
echo    [OK] SERVIZI AVVIATI
echo ========================================
echo.
echo Frontend locale: http://localhost:%FRONTEND_PORT%
echo Frontend rete:   http://%IP%:%FRONTEND_PORT%
echo Backend API:     http://%IP%:%BACKEND_PORT%
echo API Docs:        http://%IP%:%BACKEND_PORT%/docs
echo Adminer DB:      http://localhost:8080
echo.
echo Per fermare il sistema, chiudi le finestre del terminale
echo oppure esegui: cd docker ^&^& docker-compose down
echo.

pause
