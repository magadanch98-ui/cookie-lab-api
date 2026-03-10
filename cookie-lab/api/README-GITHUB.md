# 🔐 Cookie Lab API

API backend para sistema de validación de tarjetas con integración de Amazon, Stripe, PayPal y Braintree.

[![Deploy](https://img.shields.io/badge/Deploy-Render-46E3B7?style=for-the-badge)](https://render.com)
[![Node](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

---

## 🚀 Despliegue Rápido en Render

### 1️⃣ Conectar GitHub a Render

1. Ve a [Render Dashboard](https://dashboard.render.com)
2. Click en **"New +"** → **"Web Service"**
3. Click en **"Connect GitHub"** y autoriza Render
4. Selecciona el repositorio: `magadanch98-ui/cookie-lab-api`

### 2️⃣ Configurar el Servicio

- **Name**: `cookie-lab-api`
- **Region**: Oregon (US West) o la más cercana a ti
- **Branch**: `main`
- **Root Directory**: `cookie-lab/api`
- **Runtime**: Node
- **Build Command**: `npm install`
- **Start Command**: `node server.js`
- **Plan**: Free

### 3️⃣ Variables de Entorno

En la sección **Environment → Environment Variables**, agrega:

```bash
PORT=5050
COOKIE_LAB_SECRET=cookie_lab_production_secret_2026
OWNER_USER=admin
OWNER_PASS=TuPasswordSeguro123!

# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_TU_CLAVE_SECRETA
STRIPE_PUBLISHABLE_KEY=pk_live_TU_CLAVE_PUBLICA

# PayPal Configuration (opcional)
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=TU_PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET=TU_PAYPAL_CLIENT_SECRET

# Braintree Configuration (opcional)
BT_ENVIRONMENT=sandbox
BT_MERCHANT_ID=TU_MERCHANT_ID
BT_PUBLIC_KEY=TU_PUBLIC_KEY
BT_PRIVATE_KEY=TU_PRIVATE_KEY
```

⚠️ **IMPORTANTE**: Reemplaza los valores `TU_CLAVE_*` con tus credenciales reales.

### 4️⃣ Obtener Credenciales

#### Stripe
1. Ve a [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Copia **Secret Key** (comienza con `sk_live_` o `sk_test_`)
3. Copia **Publishable Key** (comienza con `pk_live_` o `pk_test_`)

#### PayPal (opcional)
1. Ve a [PayPal Developer](https://developer.paypal.com/dashboard/applications/sandbox)
2. Crea una aplicación REST API
3. Copia **Client ID** y **Secret**

#### Braintree (opcional)
1. Ve a [Braintree Sandbox](https://sandbox.braintreegateway.com/)
2. Ve a **Settings → API Keys**
3. Copia **Merchant ID**, **Public Key** y **Private Key**

### 5️⃣ Desplegar

1. Click en **"Create Web Service"**
2. Espera 2-3 minutos mientras se construye
3. Tu API estará disponible en: `https://cookie-lab-api-XXXX.onrender.com`

---

## 📡 Endpoints Disponibles

### 🔐 Autenticación Amazon

#### `POST /api/v1/signup`
Registro de nuevo usuario.

```json
{
  "name": "Juan Pérez",
  "email": "juan@ejemplo.com",
  "password": "miPassword123"
}
```

**Respuesta:**
```json
{
  "token": "a1b2c3d4e5f6..."
}
```

#### `POST /api/v1/login`
Inicio de sesión.

```json
{
  "email": "juan@ejemplo.com",
  "password": "miPassword123"
}
```

**Respuesta:**
```json
{
  "token": "a1b2c3d4e5f6..."
}
```

### 🛒 Productos

#### `GET /api/v1/products`
Listar productos con filtros y paginación.

**Query Parameters:**
- `limit` - Productos por página (default: 20)
- `page` - Número de página (default: 1)
- `sort` - Ordenar por campo (default: name)
- `name` - Filtrar por nombre
- `category` - Filtrar por categoría
- `inStock` - true/false
- `numericFilters` - ej: `price<500,rating>4`

**Ejemplo:**
```bash
GET /api/v1/products?limit=10&page=1&sort=price&numericFilters=price<500
```

**Respuesta:**
```json
{
  "products": [
    {
      "_id": "61b19d07fb9b1f6eeaaee435",
      "name": "Nori Sea Weed",
      "price": 432,
      "rating": 4.2,
      "category": "Grocery",
      "description": "Algas marinas",
      "imageURL": "https://...",
      "inStock": true
    }
  ],
  "hits": 11
}
```

#### `GET /api/v1/products/:id`
Obtener producto por ID.

### 📦 Órdenes

⚠️ **Requiere autenticación**: Header `Authorization: Bearer TOKEN`

#### `GET /api/v1/orders`
Listar órdenes del usuario autenticado.

```bash
curl -H "Authorization: Bearer a1b2c3d4e5f6..." \
  http://localhost:5050/api/v1/orders
```

#### `POST /api/v1/orders`
Crear nueva orden.

```json
{
  "products": [
    {
      "productId": "61b19d07fb9b1f6eeaaee435",
      "quantity": 2
    }
  ]
}
```

#### `PATCH /api/v1/orders/:id`
Actualizar estado de orden.

```json
{
  "status": "shipped"
}
```

### 🛒 Carrito

⚠️ **Requiere autenticación**

#### `GET /api/v1/cart`
Obtener carrito del usuario.

#### `POST /api/v1/cart`
Actualizar carrito.

```json
{
  "products": [
    {
      "productId": "61b19d07fb9b1f6eeaaee435",
      "quantity": 3
    }
  ]
}
```

#### `DELETE /api/v1/cart/:productId`
Eliminar producto del carrito.

### 💳 Stripe

#### `GET /api/stripe/config`
Obtener configuración pública de Stripe.

```json
{
  "ok": true,
  "enabled": true,
  "publishable_key": "pk_live_...",
  "network": {
    "timeout_ms": 5000,
    "max_network_retries": 3
  }
}
```

#### `POST /api/stripe/setup-intent`
Crear SetupIntent para guardar tarjeta.

#### `POST /api/stripe/customer`
Crear cliente de Stripe.

#### `POST /api/stripe/payment-method/attach`
Asociar método de pago a cliente.

### 🩺 Health Check

#### `GET /api/health`
Verificar estado del servidor.

```json
{
  "ok": true,
  "status": "running",
  "status_code": "VERIFIED",
  "uptime_seconds": 12345,
  "memory_mb": 89.45
}
```

---

## 🛠️ Desarrollo Local

### Requisitos
- Node.js 18+
- npm 9+

### Instalación

```bash
# Clonar repositorio
git clone https://github.com/magadanch98-ui/cookie-lab-api.git

# Navegar a la carpeta API
cd cookie-lab-api/cookie-lab/api

# Instalar dependencias
npm install

# Copiar archivo de ejemplo
cp .env.example .env

# Editar .env con tus credenciales
nano .env
```

### Ejecutar

```bash
# Modo desarrollo
node server.js

# El servidor iniciará en http://localhost:5050
```

### Probar

```bash
# Health check
curl http://localhost:5050/api/health

# Listar productos
curl http://localhost:5050/api/v1/products

# Configuración de Stripe
curl http://localhost:5050/api/stripe/config
```

---

## 📁 Estructura del Proyecto

```
cookie-lab-api/
├── cookie-lab/
│   └── api/
│       ├── server.js                    # Servidor principal
│       ├── package.json                 # Dependencias
│       ├── .env.example                 # Ejemplo de variables de entorno
│       ├── .gitignore                   # Archivos ignorados por Git
│       ├── README.md                    # Esta documentación
│       ├── CONFIGURAR-CREDENCIALES.md   # Guía de configuración
│       └── verificar-credenciales.bat   # Script de verificación
```

---

## 🔒 Seguridad

- ✅ **Nunca** subas el archivo `.env` a GitHub
- ✅ Usa claves **de prueba** (`sk_test_`, `pk_test_`) durante desarrollo
- ✅ Usa claves **de producción** (`sk_live_`, `pk_live_`) solo en producción
- ✅ Rota tus claves regularmente
- ✅ Monitorea los logs de Stripe/PayPal/Braintree

---

## 📊 Métricas y Monitoreo

#### `GET /api/metrics`
Ver métricas del servidor (requiere autenticación de owner).

---

## 🐛 Solución de Problemas

### Error: "ReferenceError: route is not defined"
✅ **Solucionado** en commit `f316ea1` - Endpoints migrados a formato correcto.

### Error: "Stripe is not configured"
❌ Verifica que `STRIPE_SECRET_KEY` esté configurada correctamente en `.env`

### Error: "Invalid credentials"
❌ La clave debe comenzar con `sk_live_` o `sk_test_`, NO con `mk_`

### Error: "Authorization token required"
❌ Los endpoints de Amazon requieren header: `Authorization: Bearer TOKEN`

---

## 📚 Documentación Adicional

- [CONFIGURAR-CREDENCIALES.md](CONFIGURAR-CREDENCIALES.md) - Guía completa de configuración
- [DEPLOY-RENDER.md](../DEPLOY-RENDER.md) - Despliegue en Render
- [DEPLOY-CPANEL.md](../DEPLOY-CPANEL.md) - Subir frontend a cPanel

---

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el repositorio
2. Crea una rama: `git checkout -b feature/nueva-funcionalidad`
3. Commit: `git commit -m 'Add: nueva funcionalidad'`
4. Push: `git push origin feature/nueva-funcionalidad`
5. Abre un Pull Request

---

## 📄 Licencia

Este proyecto es privado y está bajo la licencia MIT.

---

## 🎯 Estado del Proyecto

🟢 **Activo** - En desarrollo continuo

### Características Actuales
- ✅ Amazon API (9 endpoints)
- ✅ Integración con Stripe
- ✅ Soporte para Braintree
- ✅ Soporte para PayPal
- ✅ Autenticación JWT
- ✅ Base de datos en memoria
- ✅ Validación de tarjetas

### Próximas Características
- 🔄 Base de datos persistente (MongoDB/PostgreSQL)
- 🔄 Rate limiting mejorado
- 🔄 Webhooks de Stripe
- 🔄 Logs estructurados
- 🔄 Tests automatizados

---

## 📞 Contacto

- **GitHub**: [@magadanch98-ui](https://github.com/magadanch98-ui)
- **Repositorio**: [cookie-lab-api](https://github.com/magadanch98-ui/cookie-lab-api)

---

<div align="center">
  <sub>Hecho con ❤️ para validación de tarjetas</sub>
</div>
