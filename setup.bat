@echo off
title DITTO Setup - Avvio del sistema
color 0A

echo ========================================
echo    DITTO - Avvio del sistema
echo ========================================
echo.

:: Salva la directory corrente (root del progetto)
set ROOT_DIR=%CD%

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
docker-compose up -d
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

:: Verifica che Ollama sia pronto e pull il modello mistral
echo Preparazione modello AI (mistral)...
docker exec ditto_ollama ollama pull mistral >nul 2>&1
if errorlevel 1 (
    echo [AVVISO] Impossibile pullare il modello mistral. Assicurati che Ollama sia accessibile.
    echo [AVVISO] Puoi pullare manualmente con: docker exec ditto_ollama ollama pull mistral
) else (
    echo [OK] Modello mistral pronto
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
echo ADMIN_TOKEN_EXPIRE_MINUTES=120
echo ALGORITHM=HS256
echo ACCESS_TOKEN_EXPIRE_MINUTES=30
echo ALLOWED_ORIGINS=http://localhost:5173,http://%IP%:5173
echo OLLAMA_BASE_URL=http://%IP%:11434
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

:: Installa dipendenze
echo Installazione dipendenze Python...
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo [AVVISO] Problemi con l'installazione delle dipendenze
)

:: Crea tabelle
echo Creazione tabelle database...
python init_db.py

:: Popola database con dati di test
echo Popolamento database con dati di test...
python populate.py

:: Popola database con categorie e risposte preset per Ollama
echo Seeding categorie e risposte per AI...
python seed_categories.py

echo [OK] Database configurato
echo.

:: 4. Avvia backend
echo [4/5] Avvio backend FastAPI...
start "DITTO Backend" cmd /k "cd /d %ROOT_DIR%\backend && call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --no-use-colors"
echo [OK] Backend avviato su http://%IP%:8000
echo.

:: Attendi che il backend sia pronto
timeout /t 3 /nobreak >nul

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