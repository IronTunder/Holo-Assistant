@echo off
REM ========================================
REM Progetto Ditto - Start (Production Mode)
REM ========================================
REM Avvia i servizi in modalità produzione (senza hot reload)

setlocal enabledelayedexpansion

echo.
echo ========================================
echo  Progetto Ditto - Avvio Modalità Produzione
echo ========================================
echo.

REM Cartella base del progetto
set BASE_DIR=%~dp0

echo [INFO] Cartella base: %BASE_DIR%

REM ========================================
REM 1. AVVIO DOCKER (PostgreSQL)
REM ========================================
echo.
echo [FASE 1] Verificando Docker e PostgreSQL...
echo.

REM Verifica se Docker è installato
docker --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Docker non trovato. Continuando senza contenitori...
    echo [INFO] Assicurati che PostgreSQL sia in esecuzione sulla macchina!
    timeout /t 2 /nobreak
    goto :skip_docker
)

echo [OK] Docker trovato
echo [INFO] Avvio PostgreSQL via docker-compose...

cd /d "%BASE_DIR%docker"
docker-compose up -d

if %ERRORLEVEL% neq 0 (
    echo [WARNING] Impossibile avviare docker-compose.
    echo [INFO] Assicurati che Docker Desktop sia in esecuzione.
    timeout /t 2 /nobreak
    goto :skip_docker
)

echo [OK] PostgreSQL in avvio...
timeout /t 3 /nobreak
echo [OK] PostgreSQL dovrebbe essere pronto

:skip_docker

REM ========================================
REM 2. AVVIO BACKEND (senza --reload)
REM ========================================
echo.
echo [FASE 2] Avvio Backend FastAPI (produzione)...
echo.

cd /d "%BASE_DIR%backend"

REM Verifica se Python è installato
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERRORE] Python non trovato. Installa Python prima di procedere.
    pause
    exit /b 1
)

REM Verifica se venv esiste
if not exist "venv" (
    echo [WARNING] Environment virtuale non trovato. Creazione in corso...
    python -m venv venv
)

REM Attiva venv
call venv\Scripts\activate.bat

REM Installa dipendenze se necessario
pip install -q -r requirements.txt

REM Avvia il server in una nuova finestra (senza reload)
echo [OK] Avvio server backend su http://localhost:8000
start "Ditto Backend Server (Production)" cmd /k "cd /d %BASE_DIR%backend && venv\Scripts\activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

REM Attendi un momento per il startup
timeout /t 3 /nobreak

REM ========================================
REM 3. AVVIO FRONTEND (build ottimizzato)
REM ========================================
echo.
echo [FASE 3] Avvio Frontend (produzione)...
echo.

cd /d "%BASE_DIR%frontend\my-app"

REM Verifica se Node.js è installato
node --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERRORE] Node.js non trovato. Installa Node.js prima di procedere.
    pause
    exit /b 1
)

REM Installa dipendenze se necessario
if not exist "node_modules" (
    echo [WARNING] node_modules non trovato. Installazione in corso...
    call npm install
)

REM Avvia il server di preview (versione ottimizzata)
echo [OK] Avvio preview server frontend su http://localhost:5173
start "Ditto Frontend Preview (Production)" cmd /k "cd /d %BASE_DIR%frontend\my-app && npm run preview"

REM ========================================
REM 4. RIEPILOGO
REM ========================================
echo.
echo ========================================
echo  Servizi Avviati (Modalità Produzione)
echo ========================================
echo.
echo Docker:   postgres:5432 (in docker-compose)
echo Backend:  http://192.168.1.119:8000
echo Frontend: http://localhost:5173
echo.
echo Health Check: http://192.168.1.119:8000/health
echo.
echo [INFO] I servizi sono in esecuzione in due finestre separate.
echo [INFO] Premi Ctrl+C in ogni finestra per fermare i servizi.
echo.
pause

endlocal
