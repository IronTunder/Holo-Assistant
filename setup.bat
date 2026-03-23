@echo off
title Setup Progetto Ditto - Assistente Olografico
echo ========================================
echo    Setup Progetto DITTO
echo    Assistente Olografico per Industria
echo ========================================
echo.

:: Controlla se siamo nella cartella giusta
if not exist "backend\" (
    echo ERRORE: Esegui questo script dalla cartella principale ditto-project/
    echo Dove devono esistere le cartelle: backend/, frontend/, docker/, docs/
    pause
    exit /b 1
)

:: ========================================
:: 1. BACKEND - Python
:: ========================================
echo [1/5] Configurazione Backend Python...
echo.

cd backend

:: Controlla se Python e' installato
python --version >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Python non trovato. Installa Python 3.10 o superiore.
    echo Scarica da: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Crea ambiente virtuale se non esiste
if not exist "venv\" (
    echo Creazione ambiente virtuale Python...
    python -m venv venv
    echo OK Ambiente virtuale creato
) else (
    echo OK Ambiente virtuale gia esistente
)

:: Attiva ambiente virtuale e installa requirements
echo Attivazione ambiente virtuale e installazione dipendenze...
call venv\Scripts\activate.bat
pip install --upgrade pip
pip install -r requirements.txt

:: Crea file .env se non esiste
if not exist ".env" (
    echo Creazione file .env con configurazione di default...
    (
        echo DATABASE_HOST=localhost
        echo DATABASE_PORT=5432
        echo DATABASE_USER=postgres
        echo DATABASE_PASSWORD=postgres
        echo DATABASE_NAME=ditto_db
        echo SECRET_KEY=your-secret-key-change-this-in-production
        echo ALGORITHM=HS256
        echo ACCESS_TOKEN_EXPIRE_MINUTES=30
    ) > .env
    echo OK File .env creato
) else (
    echo OK File .env gia esistente
)

cd ..
echo OK Backend configurato
echo.

:: ========================================
:: 2. DOCKER - PostgreSQL
:: ========================================
echo [2/5] Avvio PostgreSQL con Docker...
echo.

cd docker

:: Controlla se Docker e' in esecuzione
docker --version >nul 2>&1
if errorlevel 1 (
    echo ATTENZIONE: Docker non trovato. PostgreSQL non verra avviato.
    echo Per usare PostgreSQL, installa Docker Desktop da: https://www.docker.com/products/docker-desktop/
    echo In alternativa, modifica backend/.env per usare SQLite
) else (
    :: Ferma eventuali container esistenti
    docker-compose down 2>nul
    
    :: Avvia PostgreSQL
    echo Avvio container PostgreSQL...
    docker-compose up -d
    
    :: Attendi che PostgreSQL sia pronto
    echo Attendere avvio PostgreSQL...
    timeout /t 5 /nobreak >nul
    
    :: Verifica che PostgreSQL sia attivo
    docker ps | findstr ditto_postgres >nul
    if errorlevel 1 (
        echo ATTENZIONE: PostgreSQL non e partito correttamente.
        echo Controlla i log con: docker logs ditto_postgres
    ) else (
        echo OK PostgreSQL avviato sulla porta 5432
    )
)

cd ..
echo.

:: ========================================
:: 3. FRONTEND - Next.js
:: ========================================
echo [3/5] Configurazione Frontend Next.js...
echo.

cd frontend

:: Controlla se Node.js e' installato
node --version >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Node.js non trovato. Installa Node.js 18 o superiore.
    echo Scarica da: https://nodejs.org/
    pause
    exit /b 1
)

:: Controlla se pnpm e' installato, altrimenti usa npm
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo pnpm non trovato, uso npm...
    set PKG_MGR=npm
) else (
    echo pnpm trovato, uso pnpm...
    set PKG_MGR=pnpm
)

:: Installa dipendenze
echo Installazione dipendenze frontend...
if "%PKG_MGR%"=="pnpm" (
    pnpm install
) else (
    npm install
)

:: Crea file .env.local per il frontend
if not exist ".env.local" (
    echo Creazione file .env.local...
    (
        echo NEXT_PUBLIC_API_URL=http://localhost:8000
    ) > .env.local
    echo OK File .env.local creato
)

cd ..
echo OK Frontend configurato
echo.

:: ========================================
:: 4. VERIFICA STRUTTURA CARTELLE
:: ========================================
echo [4/5] Verifica struttura cartelle...
echo.

:: Crea cartelle mancanti nel frontend
if not exist "frontend\components" mkdir frontend\components
if not exist "frontend\hooks" mkdir frontend\hooks
if not exist "frontend\lib" mkdir frontend\lib
if not exist "frontend\types" mkdir frontend\types
if not exist "frontend\app\operator" mkdir frontend\app\operator
if not exist "frontend\app\admin" mkdir frontend\app\admin
if not exist "frontend\public\avatar" mkdir frontend\public\avatar

echo OK Struttura cartelle verificata
echo.

:: ========================================
:: 5. RIEPILOGO FINALE
:: ========================================
echo [5/5] Setup completato!
echo.
echo ========================================
echo    RIEPILOGO
echo ========================================
echo.
echo OK Backend Python configurato
echo    - Ambiente virtuale: backend/venv/
echo    - Dipendenze installate
echo    - File .env creato
echo.
if exist "docker\docker-compose.yml" (
    echo OK Docker PostgreSQL: avviato (se Docker disponibile)
    echo    - Porta: 5432
    echo    - Utente: postgres
    echo    - Password: postgres
    echo    - Database: ditto_db
) else (
    echo ATTENZIONE Docker: non configurato
)
echo.
echo OK Frontend Next.js configurato
echo    - Dipendenze installate
echo    - File .env.local creato
echo.
echo ========================================
echo    COMANDI PER AVVIARE
echo ========================================
echo.
echo Avvia il backend:
echo   cd backend
echo   call venv\Scripts\activate
echo   uvicorn app.main:app --reload --port 8000
echo.
echo Avvia il frontend (in un altro terminale):
echo   cd frontend
echo   pnpm dev   (o npm run dev)
echo.
echo ========================================
echo    PROSSIMI PASSI
echo ========================================
echo.
echo 1. Crea le tabelle del database (esegui in backend con venv attivo):
echo    python -c "from app.database import Base, engine; Base.metadata.create_all(bind=engine)"
echo.
echo 2. Avvia il backend e il frontend
echo 3. Apri http://localhost:3000 per vedere l'app
echo.

pause