# Cookie Lab API (Simulation + Optional Sandbox Payments)

This API can run locally or in a hosted environment.

## What it does

- Issues a simulation-only cookie token (`sim_...`) signed with HMAC.
- Opens a fictitious wallet tied to that simulation session.
- Associates a card to that wallet with no real charge.
- Rejects invalid cards using Luhn validation.
- Blocks cookie after repeated failed attempts.
- Expires cookie by usage policy.

## Security policy in simulation

- `max_failed_attempts`: 3
- `max_uses`: 6
- cookie scope: `simulation-only`

## Run

```bash
cd cookie-lab/api
npm start
```

Server:

- local: `http://localhost:5050`
- hosted: `https://your-api-host.tld`

Health check:

- `GET /api/health`
- `GET /api/metrics` (observabilidad basica en memoria)

Main endpoints:

- `POST /api/session/create`
- `POST /api/wallet/open` (header `X-Sim-Cookie`)
- `POST /api/wallet/associate-card` (header `X-Sim-Cookie`)

Payment auth (test/sandbox):

- Stripe:
  - `GET /api/stripe/config`
  - `POST /api/stripe/create-intent`
  - `POST /api/stripe/setup-intent`
  - `POST /api/stripe/customer` (create or retrieve)
  - `POST /api/stripe/payment-method/attach`
  - `POST /api/stripe/offsession-charge`
  - `GET /api/stripe/charges/:id` (with `balance_transaction` expanded)
- PayPal REST:
  - `GET /api/paypal/config`
  - `POST /api/paypal/create-payment`
  - `POST /api/paypal/execute-payment`
- Braintree:
  - `GET /api/braintree/config`
  - `POST /api/braintree/client-token`
  - `POST /api/braintree/checkout`
  - `GET /api/braintree/transaction/:id` (lookup de transaccion)
  - `GET /api/braintree/payments` (Commerce Layer list with filters)
  - `POST /api/braintree/payments` (Commerce Layer create)
  - `GET /api/braintree/payments/:id` (Commerce Layer get)
  - `PATCH /api/braintree/payments/:id` (Commerce Layer update)

Environment variables:

- Core security/runtime:
  - `COOKIE_LAB_SECRET` (strong random value in production)
  - `CORS_ALLOWED_ORIGINS` (comma-separated origins, `*` only for dev)
  - `RATE_LIMIT_WINDOW_MS` (default: `60000`)
  - `RATE_LIMIT_MAX_REQUESTS` (default: `240`)
  - `METRICS_ENABLED` (default: `true`)
  - `SERVER_REQUEST_TIMEOUT_MS` (default: `15000`)
  - `SERVER_HEADERS_TIMEOUT_MS` (default: `20000`)
  - `SERVER_KEEPALIVE_TIMEOUT_MS` (default: `5000`)

- Stripe:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_TIMEOUT_MS` (default: `5000`)
  - `STRIPE_MAX_NETWORK_RETRIES` (default: `3`)
- Braintree:
  - `BT_ENVIRONMENT` (`sandbox` or `production`)
  - `BT_MERCHANT_ID`
  - `BT_PUBLIC_KEY`
  - `BT_PRIVATE_KEY`
  - `BT_MERCHANT_ACCOUNT_ID` (optional)
  - `BT_DEFAULT_SUBMIT_FOR_SETTLEMENT` (`true` or `false`, default: `false`)
- Commerce Layer (optional Braintree payments):
  - `CL_API_BASE` (example: `https://yourdomain.commercelayer.io`)
  - `CL_ACCESS_TOKEN` (Bearer token)
- PayPal REST:
  - `PAYPAL_MODE` (`sandbox` or `live`)
  - `PAYPAL_CLIENT_ID`
  - `PAYPAL_CLIENT_SECRET`
- Owner auth (optional, defaults provided):
  - `OWNER_USER`
  - `OWNER_PASS`

## PayPal example (based on v1/payments)

Create payment:

```bash
curl -X POST "https://your-api-host.tld/api/paypal/create-payment" \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "sale",
    "amount": 10,
    "currency": "USD",
    "description": "Payment description",
    "return_url": "http://localhost/success",
    "cancel_url": "http://localhost/cancel"
  }'
```

## Stripe advanced examples

Create setup intent:

```bash
curl -X POST "https://your-api-host.tld/api/stripe/setup-intent" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: setup-123" \
  -d '{
    "customer": "cus_...",
    "usage": "off_session"
  }'
```

Create or retrieve customer:

```bash
curl -X POST "https://your-api-host.tld/api/stripe/customer" \
  -H "Content-Type: application/json" \
  -d '{ "email": "test@example.com", "name": "Test User" }'
```

```bash
curl -X POST "https://your-api-host.tld/api/stripe/customer" \
  -H "Content-Type: application/json" \
  -d '{ "customer_id": "cus_..." }'
```

Attach payment method:

```bash
curl -X POST "https://your-api-host.tld/api/stripe/payment-method/attach" \
  -H "Content-Type: application/json" \
  -d '{
    "customer": "cus_...",
    "payment_method": "pm_..."
  }'
```

Off-session charge via PaymentIntent:

```bash
curl -X POST "https://your-api-host.tld/api/stripe/offsession-charge" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: offsession-123" \
  -d '{
    "amount": 10,
    "currency": "usd",
    "customer": "cus_...",
    "payment_method": "pm_...",
    "description": "Off-session test"
  }'
```

Retrieve charge with expanded balance transaction:

```bash
curl -X GET "https://your-api-host.tld/api/stripe/charges/ch_..."
```

Execute approved payment:

```bash
curl -X POST "https://your-api-host.tld/api/paypal/execute-payment" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_id": "PAY-...",
    "payer_id": "..."
  }'
```

## Braintree example (Hosted Fields + API checkout)

Do not call Braintree documentation URLs as API endpoints. Use your API endpoints:

1) Request client token

```bash
curl -X POST "https://your-api-host.tld/api/braintree/client-token" \
  -H "Content-Type: application/json"
```

Client token por customer o merchant account:

```bash
curl -X POST "https://your-api-host.tld/api/braintree/client-token" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "existing_customer_id",
    "merchant_account_id": "your_merchant_account_id"
  }'
```

1) Frontend Hosted Fields (tokenize card to get nonce)

```html
<script src="https://js.braintreegateway.com/web/3.112.0/js/client.min.js"></script>
<script src="https://js.braintreegateway.com/web/3.112.0/js/hosted-fields.min.js"></script>

<div id="card-number"></div>
<div id="cvv"></div>
<div id="expiration-date"></div>
<div id="postal-code"></div>

<script>
  const tokenResp = await fetch("https://your-api-host.tld/api/braintree/client-token", { method: "POST" });
  const tokenData = await tokenResp.json();

  const clientInstance = await braintree.client.create({
    authorization: tokenData.client_token
  });

  const hostedFields = await braintree.hostedFields.create({
    client: clientInstance,
    fields: {
      number: { selector: "#card-number" },
      cvv: { selector: "#cvv" },
      expirationDate: { selector: "#expiration-date" },
      postalCode: { selector: "#postal-code" }
    }
  });

  const payload = await hostedFields.tokenize();
  const nonce = payload.nonce;

  const checkoutResp = await fetch("https://your-api-host.tld/api/braintree/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payment_method_nonce: nonce,
      amount: 10.00,
      order_id: "ORDER-123",
      submit_for_settlement: false,
      store_in_vault_on_success: true
    })
  });
  const checkoutData = await checkoutResp.json();
  console.log(checkoutData);
</script>
```

Consultar estado de transaccion:

```bash
curl -X GET "https://your-api-host.tld/api/braintree/transaction/THE_TRANSACTION_ID"
```

## Commerce Layer Braintree Payments (optional)

These endpoints proxy Commerce Layer `braintree_payments` API.

Create payment:

```bash
curl -X POST "https://your-api-host.tld/api/braintree/payments" \
  -H "Content-Type: application/json" \
  -H "X-CL-Api-Base: https://yourdomain.commercelayer.io" \
  -H "X-CL-Access-Token: your-access-token" \
  -d '{
    "data": {
      "type": "braintree_payments",
      "attributes": { "payment_method_nonce": "fake-valid-nonce" },
      "relationships": { "order": { "data": { "type": "orders", "id": "..." } } }
    }
  }'
```

## Amazon Gateway API (E-commerce Simulation)

Complete REST API para simular funcionalidad de Amazon (usuarios, productos, carritos, órdenes).

### Autenticación

**Registro de usuario**

```bash
curl -X POST "https://your-api-host.tld/api/v1/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "usuario",
    "email": "usuario@gmail.com",
    "password": "password"
  }'
```

Respuesta: `{ "token": "userToken" }`

**Login de usuario**

```bash
curl -X POST "https://your-api-host.tld/api/v1/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@gmail.com",
    "password": "password"
  }'
```

Respuesta: `{ "token": "userToken" }`

### Productos

**Listar productos con filtros**

```bash
curl "https://your-api-host.tld/api/v1/products?limit=20&page=1&sort=name&name=nori&category=grocery&select=-description&numericFilters=price<500,rating<4&inStock=true"
```

Parámetros opcionales:
- `limit`: Cantidad de resultados (default: 20)
- `page`: Número de página (default: 1)
- `sort`: Campo para ordenar (default: name)
- `name`: Filtro por nombre (búsqueda parcial)
- `category`: Filtro por categoría exacta
- `inStock`: true/false para disponibilidad
- `select`: Campos a excluir con "-" (ej: "-description")
- `numericFilters`: Filtros numéricos (ej: "price<500,rating<4")

Respuesta:
```json
{
  "products": [
    {
      "_id": "61b19d07fb9b1f6eeaaee443",
      "name": "Nori Sea Weed Premium",
      "price": 455,
      "rating": 1.1,
      "category": "Grocery",
      "imageURL": "https://...",
      "inStock": true
    }
  ],
  "hits": 1
}
```

**Obtener producto por ID**

```bash
curl "https://your-api-host.tld/api/v1/products/61b19d07fb9b1f6eeaaee436"
```

Respuesta: Objeto completo del producto con descripción.

### Carrito de Compras

**Crear/actualizar carrito** (requiere autenticación)

```bash
curl -X POST "https://your-api-host.tld/api/v1/cart" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "products": [
      {
        "productId": "61b19d07fb9b1f6eeaaee436",
        "name": "Nori Sea Weed",
        "price": 432,
        "quantity": 2,
        "description": "..."
      },
      {
        "productId": "61b19d07fb9b1f6eeaaee437",
        "name": "Onions - Red Pearl",
        "price": 109,
        "quantity": 3,
        "description": "..."
      }
    ]
  }'
```

Respuesta:
```json
{
  "cart": {
    "_id": "61bc27d8d5a0f23d1530406d",
    "createdBy": "61b191c74acb420c1c688d88",
    "products": [
      {
        "productId": "61b19d07fb9b1f6eeaaee436",
        "name": "Nori Sea Weed",
        "price": 432,
        "quantity": 2,
        "stock": "In Stock"
      }
    ],
    "__v": 0
  }
}
```

**Obtener carrito** (requiere autenticación)

```bash
curl "https://your-api-host.tld/api/v1/cart" \
  -H "Authorization: Bearer <token>"
```

**Eliminar producto del carrito** (requiere autenticación)

```bash
curl -X DELETE "https://your-api-host.tld/api/v1/cart/61b19d07fb9b1f6eeaaee436" \
  -H "Authorization: Bearer <token>"
```

### Órdenes

**Listar órdenes** (requiere autenticación)

```bash
curl "https://your-api-host.tld/api/v1/orders?sort=orderedAt" \
  -H "Authorization: Bearer <token>"
```

Respuesta:
```json
{
  "orders": [
    {
      "products": [
        {
          "productId": "61b19d07fb9b1f6eeaaee436",
          "quantity": 1,
          "productName": "Nori Sea Weed",
          "productPrice": 432,
          "productImage": "https://..."
        }
      ],
      "orderedAt": "2021-12-15T06:47:02.312Z",
      "orderStatus": "pending",
      "_id": "61b990628d3f2010015a1647"
    }
  ]
}
```

**Crear nueva orden** (requiere autenticación)

```bash
curl -X POST "https://your-api-host.tld/api/v1/orders" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "products": [
      {
        "productId": "61b19d07fb9b1f6eeaaee43a",
        "quantity": 3
      },
      {
        "productId": "61b19d07fb9b1f6eeaaee43b",
        "quantity": 4
      }
    ]
  }'
```

Respuesta: Documento completo `userOrder` con todas las órdenes del usuario.

**Actualizar estado de orden** (requiere autenticación)

```bash
curl -X PATCH "https://your-api-host.tld/api/v1/orders/61b978a7336d5f511c90fe12" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "cancelled"
  }'
```

Estados disponibles: `pending`, `processing`, `shipped`, `delivered`, `cancelled`

Respuesta: Documento `userOrder` actualizado con `lastUpdatedAt` en la orden modificada.

### Notas de Amazon API

- Todos los datos se almacenan en memoria (se reinician al reiniciar el servidor)
- 11 productos de muestra incluidos (categorías: Grocery, Frozen, Baking, Dairy, Condiments)
- Los tokens generados en signup/login son persistentes durante la sesión del servidor
- Los carritos son únicos por usuario (se sobrescriben al enviar nuevos productos)
- Las órdenes se acumulan en un documento por usuario
- Precios en centavos (ej: 432 = $4.32 USD)

  -d '{
    "order_id": "ABCRtyUpBa",
    "reference": "ANY-EXTERNAL-REFERENCE",
    "reference_origin": "CHECKER",
    "metadata": { "foo": "bar" }
  }'
```

Get payment by id:

```bash
curl -X GET "https://your-api-host.tld/api/braintree/payments/XAyRWNUzyN" \
  -H "X-CL-Api-Base: https://yourdomain.commercelayer.io" \
  -H "X-CL-Access-Token: your-access-token"
```

Patch payment (set nonce):

```bash
curl -X PATCH "https://your-api-host.tld/api/braintree/payments/XAyRWNUzyN" \
  -H "Content-Type: application/json" \
  -H "X-CL-Api-Base: https://yourdomain.commercelayer.io" \
  -H "X-CL-Access-Token: your-access-token" \
  -d '{
    "payment_method_nonce": "xxxx.yyyy.zzzz",
    "order_id": "ABCRtyUpBa"
  }'
```

List with filters:

```bash
curl -X GET "https://your-api-host.tld/api/braintree/payments?filter[reference]=ANY-EXTERNAL-REFERENCE&filter[order]=ABCRtyUpBa" \
  -H "X-CL-Api-Base: https://yourdomain.commercelayer.io" \
  -H "X-CL-Access-Token: your-access-token"
```

Supported filter fields:

- `id`
- `created_at`
- `updated_at`
- `reference`
- `reference_origin`
- `metadata`
- `order`

## Frontend on Hosting (non-local API)

When your frontend is deployed to a host and the API runs on a different host, configure API base in `index.html`:

```html
<meta name="elite-api-base" content="https://your-api-host.tld">
```

You can also set it dynamically before loading `app.js`:

```html
<script>
  window.ELITE_API_BASES = ["https://your-api-host.tld"];
</script>
```

Notes:

- Use `https` in production to avoid mixed-content blocking.
- In production host mode, localhost fallback is disabled automatically.

## Notes

- Wallet/card association endpoints are simulation-only (no real charge).
- Stripe/Braintree endpoints are real SDK integrations and require valid credentials.
