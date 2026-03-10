# Deploy rapido en cPanel (solo subir y extraer)

Este proyecto ya esta preparado para hosting y API no-local.

## 1) Subir y extraer

- Sube el archivo ZIP del proyecto a tu carpeta Document Root.
- Extrae el ZIP.
- Debe quedar la app en `DOCUMENT_ROOT/cookie-lab/`.

Si no existe `public_html`, usa la ruta que tu hosting marque como Document Root, por ejemplo:

- `www/`
- `htdocs/`
- `httpdocs/`
- `domains/TU-DOMINIO/public/`
- la carpeta raiz indicada en cPanel > Domains > Document Root

## 2) Frontend

- URL esperada: `https://TU-DOMINIO/cookie-lab/`
- El frontend usa API por `window.location.origin` si no defines otra base.

Opcional (si la API corre en otro dominio/subdominio):

- Edita `DOCUMENT_ROOT/cookie-lab/index.html` y coloca:
  - `<meta name="elite-api-base" content="https://TU-API-DOMINIO">`

## 3) API Node.js en cPanel

En cPanel -> Setup Node.js App:

- Node version: 18+ (recomendado 20)
- Application root: carpeta donde subas `cookie-lab/api`
- Application startup file: `server.js`
- Application URL: subdominio o ruta de API

Variables de entorno (copiar de `.env.example`):

- `OWNER_USER`
- `OWNER_PASS`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `BT_ENVIRONMENT`
- `BT_MERCHANT_ID`
- `BT_PUBLIC_KEY`
- `BT_PRIVATE_KEY`

Luego:

- Run NPM Install
- Restart App

## 4) Checklist de validacion

- `https://TU-API-DOMINIO/api/health` responde `ok: true`
- En frontend, modo Gate Auth puede iniciar validacion sin cookie de usuario
- En Amazon Cookies, el cooldown sigue activo solo para ese modo

## 5) Nota importante

- Stripe/Braintree reales solo funcionan si las credenciales estan configuradas en cPanel.
- Si no hay credenciales, el chequeo por tarjetas sigue funcionando en modo simulado API.
