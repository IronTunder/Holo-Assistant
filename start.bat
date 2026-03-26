@echo off
REM ========================================
REM Progetto Ditto - Start Services Script
REM ========================================
REM Avvia il backend e frontend quando il database è già inizializzato

setlocal enabledelayedexpansion

:: Imposta colori
color 0A

:: Variabili configurabili
set BACKEND_PORT=8000
set FRONTEND_PORT=5173
set IP=

echo.
echo ========================================
echo  Progetto Ditto - Avvio Servizi
echo ========================================
echo.

:: Cartella base del progetto
set BASE_DIR=%~dp0
echo [INFO] Cartella base: %BASE_DIR%

:: Ottieni IP locale
call :get_local_ip
echo [INFO] IP locale: %IP%

:: ========================================
:: 1. AVVIO DOCKER (PostgreSQL)
:: ========================================
echo.
echo [FASE 1] Verificando Docker e PostgreSQL...
echo.

:: Verifica se Docker è installato
docker --version >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [WARNING] Docker non trovato. Continuando senza contenitori...
    echo [INFO] Assicurati che PostgreSQL sia in esecuzione sulla macchina!
    timeout /t 2 /nobreak >nul
    goto :skip_docker
)

echo [OK] Docker trovato
echo [INFO] Avvio PostgreSQL via docker-compose...

cd /d "%BASE_DIR%docker"

:: Ferma container esistenti
docker-compose down 2>nul

:: Avvia container
docker-compose up -d
if !ERRORLEVEL! neq 0 (
    echo [WARNING] Impossibile avviare docker-compose. 
    echo [INFO] Assicurati che Docker Desktop sia in esecuzione.
    timeout /t 2 /nobreak >nul
    goto :skip_docker
)

echo [OK] Container avviati

:: Attendi che PostgreSQL sia pronto
echo [INFO] Attendendo che PostgreSQL sia pronto...
set MAX_ATTEMPTS=30
set ATTEMPT=1

:wait_postgres
docker ps 2>nul | findstr postgres >nul
if !ERRORLEVEL! equ 0 (
    docker exec ditto_postgres pg_isready -U postgres >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo [OK] PostgreSQL e' pronto
        goto :postgres_ready
    )
)

if !ATTEMPT! equ !MAX_ATTEMPTS! (
    echo [WARNING] PostgreSQL potrebbe non essere pronto
    goto :postgres_ready
)

set /a ATTEMPT+=1
<nul set /p "=."
timeout /t 2 /nobreak >nul
goto :wait_postgres

:postgres_ready
echo.

:skip_docker

:: ========================================
:: 2. AVVIO BACKEND
:: ========================================
echo.
echo [FASE 2] Avvio Backend FastAPI...
echo.

cd /d "%BASE_DIR%backend"

:: Verifica se Python è installato
python --version >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERRORE] Python non trovato. Installa Python prima di procedere.
    pause
    exit /b 1
)

echo [OK] Python trovato: 
python --version

:: Verifica se venv esiste
if not exist "venv" (
    echo [WARNING] Environment virtuale non trovato. Creazione in corso...
    python -m venv venv
    echo [OK] Ambiente virtuale creato
)

:: Verifica se la porta è libera
call :is_port_available !BACKEND_PORT!
if !PORT_AVAILABLE! equ 1 (
    echo [OK] Avvio server backend su http://!IP!:!BACKEND_PORT!
    
    :: Crea script temporaneo per avviare il backend
    set BACKEND_SCRIPT=%TEMP%\ditto_backend_%RANDOM%.bat
    (
        echo @echo off
        echo cd /d "%BASE_DIR%backend"
        echo call venv\Scripts\activate.bat
        echo echo.
        echo echo Backend Ditto in esecuzione su http://0.0.0.0:!BACKEND_PORT!
        echo echo.
        echo python -m uvicorn app.main:app --reload --host 0.0.0.0 --port !BACKEND_PORT! --no-use-colors
        echo echo.
        echo echo Backend terminato. Premi un tasto per chiudere...
        echo pause
        echo del "%%~f0"
    ) > "!BACKEND_SCRIPT!"
    
    :: Avvia in una nuova finestra
    start "Ditto Backend Server" cmd /k "call \"!BACKEND_SCRIPT!\""
    
) else (
    echo [WARNING] Porta !BACKEND_PORT! gia' in uso: backend non avviato.
    echo [INFO] Se Ditto e' gia' attivo, puoi usare http://!IP!:!BACKEND_PORT!
    echo [INFO] Per usare un'altra porta: set BACKEND_PORT=8001 ^&^& start.bat
)

:: Attendi un momento per lo startup
timeout /t 3 /nobreak >nul

:: ========================================
:: 3. AVVIO FRONTEND
:: ========================================
echo.
echo [FASE 3] Avvio Frontend (React + Vite)...
echo.

cd /d "%BASE_DIR%frontend\my-app"

:: Verifica se Node.js è installato
node --version >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERRORE] Node.js non trovato. Installa Node.js prima di procedere.
    pause
    exit /b 1
)

echo [OK] Node.js trovato: 
node --version
echo [OK] npm trovato: 
npm --version

:: Crea .env se non esiste
if not exist ".env" (
    echo [INFO] Creazione file .env con VITE_API_URL=http://!IP!:!BACKEND_PORT!
    echo VITE_API_URL=http://!IP!:!BACKEND_PORT! > .env
)

:: Installa dipendenze se necessario
if not exist "node_modules" (
    echo [WARNING] node_modules non trovato. Installazione in corso (potrebbe richiedere tempo)...
    call npm install
    echo [OK] Dipendenze installate
)

:: Verifica se la porta è libera
call :is_port_available !FRONTEND_PORT!
if !PORT_AVAILABLE! equ 1 (
    echo [OK] Avvio dev server frontend su http://localhost:!FRONTEND_PORT!
    
    :: Crea script temporaneo per avviare il frontend
    set FRONTEND_SCRIPT=%TEMP%\ditto_frontend_%RANDOM%.bat
    (
        echo @echo off
        echo cd /d "%BASE_DIR%frontend\my-app"
        echo echo.
        echo echo Frontend Ditto in esecuzione su http://0.0.0.0:!FRONTEND_PORT!
        echo echo.
        echo npm run dev -- --host 0.0.0.0
        echo echo.
        echo echo Frontend terminato. Premi un tasto per chiudere...
        echo pause
        echo del "%%~f0"
    ) > "!FRONTEND_SCRIPT!"
    
    :: Avvia in una nuova finestra
    start "Ditto Frontend Dev Server" cmd /k "call \"!FRONTEND_SCRIPT!\""
    
) else (
    echo [WARNING] Porta !FRONTEND_PORT! gia' in uso: frontend non avviato.
    echo [INFO] Se il frontend e' gia' attivo, puoi usare http://localhost:!FRONTEND_PORT!
)

timeout /t 3 /nobreak >nul

:: ========================================
:: 4. RIEPILOGO
:: ========================================
echo.
echo ========================================
echo  Servizi Avviati Con Successo!
echo ========================================
echo.
echo Docker:   postgres:5432 (in docker-compose)
echo Backend:  http://!IP!:!BACKEND_PORT!
echo Frontend: http://localhost:!FRONTEND_PORT!
echo.
echo Documentazione API: http://!IP!:!BACKEND_PORT!/docs
echo Health Check:       http://!IP!:!BACKEND_PORT!/health
echo.
echo [INFO] I servizi sono in esecuzione in finestre separate.
echo [INFO] Per fermare i servizi:
echo        - Chiudi le finestre del terminale
echo        - Oppure esegui: cd docker ^&^& docker-compose down
echo.

:: Salva informazioni in un file
(
    echo === DITTO - Informazioni di sistema ===
    echo Data avvio: %date% %time%
    echo IP Server: !IP!
    echo.
    echo URL:
    echo - Frontend locale: http://localhost:!FRONTEND_PORT!
    echo - Frontend rete: http://!IP!:!FRONTEND_PORT!
    echo - Backend: http://!IP!:!BACKEND_PORT!
    echo - API Docs: http://!IP!:!BACKEND_PORT!/docs
    echo.
    echo Comandi utili:
    echo - Ferma container: cd docker ^&^& docker-compose down
    echo - Log container: docker-compose logs -f
    echo.
    echo Credenziali di test:
    echo - Username: Mario Rossi, Luigi Verdi, Anna Bianchi, Marco Neri
    echo - Password: password123
) > "%BASE_DIR%ditto_info.txt"
echo [OK] Informazioni salvate in: %BASE_DIR%ditto_info.txt
echo.

pause

endlocal
goto :eof

:: ========================================
:: FUNZIONI
:: ========================================

:get_local_ip
    :: Ottieni IP locale (escludendo 127.0.0.1)
    set IP=
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
        set "temp=%%a"
        set "temp=!temp: =!"
        if not "!temp!"=="127.0.0.1" (
            set IP=!temp!
            goto :ip_found
        )
    )
    
    :: Se non trovato, usa localhost
    if "!IP!"=="" set IP=localhost
    
    :ip_found
    exit /b

:is_port_available
    set PORT_AVAILABLE=0
    set PORT=%~1
    
    :: Usa netstat per verificare se la porta è in uso
    netstat -an 2>nul | findstr /c":!PORT! " | findstr /c:"LISTENING" >nul
    if !ERRORLEVEL! neq 0 (
        set PORT_AVAILABLE=1
    )
    
    exit /b