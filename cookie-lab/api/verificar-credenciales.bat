@echo off
echo ============================================
echo  VERIFICADOR DE CREDENCIALES - Cookie Lab
echo ============================================
echo.

REM Verificar si existe .env
if not exist ".env" (
    echo [X] ERROR: Archivo .env no encontrado
    echo.
    echo Copia .env.example a .env y configura tus credenciales:
    echo   copy .env.example .env
    echo   notepad .env
    echo.
    pause
    exit /b 1
)

echo [OK] Archivo .env encontrado
echo.

REM Verificar si el servidor está corriendo
echo Verificando servidor en http://localhost:5050...
curl -s http://localhost:5050/api/health > nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [X] ERROR: Servidor no esta corriendo
    echo.
    echo Inicia el servidor primero:
    echo   npm start
    echo.
    pause
    exit /b 1
)

echo [OK] Servidor en ejecucion
echo.
echo ============================================
echo  VERIFICANDO CONFIGURACION DE APIs
echo ============================================
echo.

REM Verificar Stripe
echo [1/3] Verificando Stripe...
curl -s http://localhost:5050/api/stripe/config | findstr "enabled" > nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       [OK] Stripe configurado
) else (
    echo       [X] Stripe NO configurado
)

REM Verificar PayPal
echo [2/3] Verificando PayPal...
curl -s http://localhost:5050/api/paypal/config | findstr "enabled" > nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       [OK] PayPal configurado
) else (
    echo       [X] PayPal NO configurado
)

REM Verificar Braintree
echo [3/3] Verificando Braintree...
curl -s http://localhost:5050/api/braintree/config | findstr "enabled" > nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo       [OK] Braintree configurado
) else (
    echo       [X] Braintree NO configurado
)

echo.
echo ============================================
echo  VERIFICACION COMPLETA
echo ============================================
echo.
echo Lee CONFIGURAR-CREDENCIALES.md para instrucciones detalladas
echo.
pause
