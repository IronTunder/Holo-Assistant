@echo off
setlocal
title HOLO-ASSISTANT Start - Windows

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERRORE] Start non completato. Exit code: %EXIT_CODE%
    pause
)

exit /b %EXIT_CODE%
