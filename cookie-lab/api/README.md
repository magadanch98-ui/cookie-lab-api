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

Main endpoints:

- `POST /api/session/create`
- `POST /api/wallet/open` (header `X-Sim-Cookie`)
- `POST /api/wallet/associate-card` (header `X-Sim-Cookie`)

Payment auth (test/sandbox):

- Stripe:
  - `GET /api/stripe/config`
  - `POST /api/stripe/create-intent`
- Braintree:
  - `GET /api/braintree/config`
  - `POST /api/braintree/client-token`
  - `POST /api/braintree/checkout`

Environment variables:

- Stripe:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_PUBLISHABLE_KEY`
- Braintree:
  - `BT_ENVIRONMENT` (`sandbox` or `production`)
  - `BT_MERCHANT_ID`
  - `BT_PUBLIC_KEY`
  - `BT_PRIVATE_KEY`
- Owner auth (optional, defaults provided):
  - `OWNER_USER`
  - `OWNER_PASS`

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
