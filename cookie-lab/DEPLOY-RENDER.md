# Deploy rapido en Render (gratis)

## 1) Subir a GitHub
- Sube este proyecto a un repositorio en GitHub.
- Este repo ya incluye `render.yaml` para autoconfigurar el deploy.

## 2) Crear servicio en Render
- Entra a Render y elige **New + Blueprint**.
- Conecta tu repositorio.
- Render leera `render.yaml` y creara el servicio `cookie-lab-api`.

## 3) Variables de entorno
Configura al menos:
- `OWNER_USER`
- `OWNER_PASS`

Opcionales para pagos reales:
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `BT_ENVIRONMENT`
- `BT_MERCHANT_ID`
- `BT_PUBLIC_KEY`
- `BT_PRIVATE_KEY`

## 4) Probar API
- Abre: `https://TU-SERVICIO.onrender.com/api/health`
- Debe responder `ok: true`.

## 5) Conectar frontend
- Edita `cookie-lab/index.html`.
- En la meta `elite-api-base`, pon la URL de Render, por ejemplo:
  - `https://cookie-lab-api.onrender.com`

Ejemplo:
```html
<meta name="elite-api-base" content="https://cookie-lab-api.onrender.com">
```

## 6) Subir frontend a tu hosting
- Sube `cookie-lab/index.html` y `cookie-lab/app.js` a tu dominio.
