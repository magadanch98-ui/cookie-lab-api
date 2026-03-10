# ============================================
# GUÍA RÁPIDA: CONFIGURACIÓN DE CREDENCIALES
# ============================================

## 📋 PASOS PARA CONFIGURAR LAS APIs

### 1️⃣ STRIPE (Recomendado para empezar)

**Crear cuenta:**
1. Ve a https://stripe.com
2. Regístrate con tu email
3. Completa la verificación inicial

**Obtener credenciales:**
1. Ve a Dashboard > Developers > API keys
2. Copia las claves de TEST (para pruebas):
   - `Secret key` → empieza con `sk_test_...`
   - `Publishable key` → empieza con `pk_test_...`

**Configurar en .env:**
```bash
STRIPE_SECRET_KEY=sk_test_51ABC...XYZ
STRIPE_PUBLISHABLE_KEY=pk_test_51DEF...XYZ
```

**Probar:**
```bash
curl -X GET http://localhost:5050/api/stripe/config
```

---

### 2️⃣ BRAINTREE

**Crear cuenta:**
1. Ve a https://www.braintreegateway.com/sandbox
2. Regístrate para cuenta sandbox (gratis)

**Obtener credenciales:**
1. Inicia sesión en el dashboard
2. Ve a Settings > API
3. Copia:
   - Merchant ID
   - Public Key  
   - Private Key
   - Merchant Account ID (opcional)

**Configurar en .env:**
```bash
BT_ENVIRONMENT=sandbox
BT_MERCHANT_ID=tu_merchant_id
BT_PUBLIC_KEY=tu_public_key
BT_PRIVATE_KEY=tu_private_key
```

**Probar:**
```bash
curl -X GET http://localhost:5050/api/braintree/config
```

---

### 3️⃣ PAYPAL

**Crear cuenta:**
1. Ve a https://developer.paypal.com/
2. Inicia sesión con tu cuenta PayPal personal
3. Acepta los términos de desarrollador

**Obtener credenciales:**
1. Ve a Dashboard > My Apps & Credentials
2. En "Sandbox", crea una nueva app:
   - Nombre: "Cookie Lab API"
   - Tipo: Merchant
3. Copia:
   - Client ID
   - Secret

**Configurar en .env:**
```bash
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=AbCdEf123...
PAYPAL_CLIENT_SECRET=XyZ789...
```

**Probar:**
```bash
curl -X GET http://localhost:5050/api/paypal/config
```

---

## 🚀 INICIAR SERVIDOR CON CREDENCIALES

### Windows:
```bash
cd cookie-lab\api
npm start
```

### Linux/Mac:
```bash
cd cookie-lab/api
export $(cat .env | xargs) && node server.js
```

---

## ✅ VERIFICAR CONFIGURACIÓN

Ejecuta estos comandos para verificar que las APIs están configuradas:

```powershell
# Health check general
Invoke-RestMethod -Uri "http://localhost:5050/api/health"

# Verificar Stripe
Invoke-RestMethod -Uri "http://localhost:5050/api/stripe/config"

# Verificar PayPal
Invoke-RestMethod -Uri "http://localhost:5050/api/paypal/config"

# Verificar Braintree
Invoke-RestMethod -Uri "http://localhost:5050/api/braintree/config"
```

**Respuestas esperadas:**
- `"enabled": true` → Credenciales configuradas ✅
- `"enabled": false` → Faltan credenciales ❌

---

## 🧪 TARJETAS DE PRUEBA

### Stripe Test Cards:
- **Aprobada**: `4242424242424242`
- **Declinada**: `4000000000000002`
- **Requiere 3D Secure**: `4000002500003155`
- **Fondos insuficientes**: `4000000000009995`

**Cualquier tarjeta:**
- CVC: `123` o `456`
- Fecha: Cualquier fecha futura
- Código postal: Cualquier código

### Braintree Test Cards:
- **Aprobada**: `4111111111111111`
- **Declinada**: `4000111111111115`
- **Processor declined**: `4000111111111127`

### PayPal Sandbox:
- Usa las cuentas de prueba creadas en el sandbox
- Email: `sb-xxxxx@personal.example.com`
- Password: Ver en Sandbox Accounts

---

## 🔒 SEGURIDAD

**⚠️ IMPORTANTE:**
1. ✅ El archivo `.env` está en `.gitignore`
2. ✅ NO compartas tus credenciales
3. ✅ Usa claves SANDBOX/TEST para desarrollo
4. ✅ Rota las claves periódicamente
5. ✅ Para producción, obtén claves LIVE y despliega en Render/Vercel

---

## 🌐 DESPLEGAR EN RENDER (con credenciales)

1. Ve a https://render.com
2. Conecta tu repositorio
3. En "Environment Variables", agrega:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PUBLISHABLE_KEY`
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `BT_MERCHANT_ID`
   - `BT_PUBLIC_KEY`
   - `BT_PRIVATE_KEY`

4. Deploy automático cada push a main

---

## 📞 SOPORTE

**Documentación oficial:**
- Stripe: https://stripe.com/docs/api
- Braintree: https://developer.paypal.com/braintree/docs
- PayPal: https://developer.paypal.com/docs/api/overview/

**Problemas comunes:**
- "enabled: false" → Credenciales no configuradas o inválidas
- "401 Unauthorized" → Credenciales incorrectas
- "API error" → Verifica que las claves sean de SANDBOX
