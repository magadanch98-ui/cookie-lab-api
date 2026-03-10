@echo off
setlocal

echo [INFO] Buscando proceso en puerto 5050...
set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5050 .*LISTENING"') do (
  set "FOUND=1"
  echo [INFO] Cerrando PID %%P
  taskkill /PID %%P /F >nul 2>nul
)

if "%FOUND%"=="0" (
  echo [INFO] No hay proceso escuchando en puerto 5050.
) else (
  echo [INFO] Proceso(s) detenido(s).
)

pause
exit /b 0
