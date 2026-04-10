@echo off
setlocal
title HOLO-ASSISTANT Setup - Windows

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERRORE] Setup non completato. Exit code: %EXIT_CODE%
    pause
)

exit /b %EXIT_CODE%
