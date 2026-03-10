@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "API_DIR=%ROOT_DIR%cookie-lab\api"
set "START_API=%API_DIR%\start-api.bat"
set "INDEX_FILE=%ROOT_DIR%index.html"

if not exist "%START_API%" (
  echo [ERROR] No se encontro: %START_API%
  pause
  exit /b 1
)

if not exist "%INDEX_FILE%" (
  echo [ERROR] No se encontro: %INDEX_FILE%
  pause
  exit /b 1
)

echo [INFO] Iniciando API en ventana separada...
start "Cookie Lab API" cmd /k "cd /d "%API_DIR%" && call "%START_API%""

timeout /t 2 /nobreak >nul

echo [INFO] Abriendo index principal...
start "" "%INDEX_FILE%"

echo [OK] Flujo iniciado: API + index.html
exit /b 0
