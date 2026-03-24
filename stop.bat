@echo off
REM ========================================
REM Progetto Ditto - Stop Services Script
REM ========================================
REM Termina il backend e frontend

echo.
echo ========================================
echo  Progetto Ditto - Arresto Servizi
echo ========================================
echo.

REM Uccidi i processi Python (backend)
echo [INFO] Arresto backend FastAPI...
taskkill /FI "WINDOWTITLE eq Ditto Backend*" /T /F 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Backend fermato
) else (
    echo [INFO] Backend non trovato (potrebbe già essere fermo)
)

REM Uccidi i processi Node.js (frontend)
echo [INFO] Arresto frontend dev server...
taskkill /FI "WINDOWTITLE eq Ditto Frontend*" /T /F 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Frontend fermato
) else (
    echo [INFO] Frontend non trovato (potrebbe già essere fermo)
)

echo.
echo ========================================
echo  Servizi Fermati
echo ========================================
echo.
pause

endlocal
