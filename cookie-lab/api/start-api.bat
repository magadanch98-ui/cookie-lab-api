@echo off
setlocal ENABLEDELAYEDEXPANSION

set "API_DIR=%~dp0"
set "NODE_EXE="

if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE (
  for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v*-win-x64") do (
    if exist "%%~fD\node.exe" set "NODE_EXE=%%~fD\node.exe"
  )
)

if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 for /f "delims=" %%N in ('where node') do set "NODE_EXE=%%N"
)

if not defined NODE_EXE (
  echo [ERROR] No se encontro Node.js.
  echo Instala Node LTS y vuelve a intentar.
  pause
  exit /b 1
)

echo [INFO] Usando Node: %NODE_EXE%
pushd "%API_DIR%"
"%NODE_EXE%" server.js
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo [INFO] API finalizada con codigo %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
