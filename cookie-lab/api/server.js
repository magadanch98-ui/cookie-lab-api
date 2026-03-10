require("dotenv").config();

const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");
const Stripe = require("stripe");
const braintree = require("braintree");

const PORT = Number(process.env.PORT) || 5050;
const SECRET = process.env.COOKIE_LAB_SECRET || "cookie_lab_sim_secret_v1";
const MAX_FAILED_ATTEMPTS = 3;
const MAX_USES = 6;
const CORS_ALLOWED_ORIGINS_RAW = String(process.env.CORS_ALLOWED_ORIGINS || "*");
const RATE_LIMIT_WINDOW_MS = Math.max(1_000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000));
const RATE_LIMIT_MAX_REQUESTS = Math.max(1, Number(process.env.RATE_LIMIT_MAX_REQUESTS || 240));
const METRICS_ENABLED = String(process.env.METRICS_ENABLED || "true").toLowerCase() !== "false";
const OWNER_USER = process.env.OWNER_USER || "owner";
const OWNER_PASS = process.env.OWNER_PASS || "owner123";
const OWNER_TOKEN_TTL_MS = 1000 * 60 * 60 * 2;
const ACCESS_KEY_MIN_TTL_MINUTES = 1;
const ACCESS_KEY_MAX_TTL_MINUTES = 60 * 24;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_TIMEOUT_MS = Number(process.env.STRIPE_TIMEOUT_MS || 5000);
const STRIPE_MAX_NETWORK_RETRIES = Number(process.env.STRIPE_MAX_NETWORK_RETRIES || 3);
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
    timeout: Number.isFinite(STRIPE_TIMEOUT_MS) ? STRIPE_TIMEOUT_MS : 5000,
    maxNetworkRetries: Number.isFinite(STRIPE_MAX_NETWORK_RETRIES) ? STRIPE_MAX_NETWORK_RETRIES : 3
  })
  : null;
const BT_ENV = (process.env.BT_ENVIRONMENT || "sandbox").toLowerCase();
const BT_MERCHANT_ID = process.env.BT_MERCHANT_ID || "";
const BT_PUBLIC_KEY = process.env.BT_PUBLIC_KEY || "";
const BT_PRIVATE_KEY = process.env.BT_PRIVATE_KEY || "";
const BT_MERCHANT_ACCOUNT_ID = process.env.BT_MERCHANT_ACCOUNT_ID || "";
const BT_DEFAULT_SUBMIT_FOR_SETTLEMENT = String(process.env.BT_DEFAULT_SUBMIT_FOR_SETTLEMENT || "false").toLowerCase() === "true";
const CL_API_BASE = process.env.CL_API_BASE || "";
const CL_ACCESS_TOKEN = process.env.CL_ACCESS_TOKEN || "";
const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_API_BASE = PAYPAL_MODE === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";
const btEnvironment = BT_ENV === "production" ? braintree.Environment.Production : braintree.Environment.Sandbox;
const btGateway = BT_MERCHANT_ID && BT_PUBLIC_KEY && BT_PRIVATE_KEY
  ? new braintree.BraintreeGateway({
    environment: btEnvironment,
    merchantId: BT_MERCHANT_ID,
    publicKey: BT_PUBLIC_KEY,
    privateKey: BT_PRIVATE_KEY
  })
  : null;

const rateLimitBuckets = new Map();
const metricsState = {
  startedAt: Date.now(),
  totalRequests: 0,
  byStatusClass: {
    "2xx": 0,
    "4xx": 0,
    "5xx": 0,
    other: 0
  },
  routes: new Map()
};
const CORS_ALLOWED_ORIGINS = CORS_ALLOWED_ORIGINS_RAW
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function resolveCorsOrigin(requestOrigin) {
  const origin = String(requestOrigin || "").trim();
  if (!CORS_ALLOWED_ORIGINS.length || CORS_ALLOWED_ORIGINS.includes("*")) {
    return origin || "*";
  }
  if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return CORS_ALLOWED_ORIGINS[0] || "null";
}

function getClientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return String(req.socket?.remoteAddress || "unknown");
}

function isPathRateLimited(pathname) {
  if (!pathname) return false;
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/health");
}

function consumeRateLimit(ip, pathname) {
  if (!isPathRateLimited(pathname)) {
    return { limited: false, remaining: RATE_LIMIT_MAX_REQUESTS };
  }

  const now = Date.now();
  const bucketKey = `${ip}|${Math.floor(now / RATE_LIMIT_WINDOW_MS)}`;
  const current = rateLimitBuckets.get(bucketKey) || 0;
  const next = current + 1;
  rateLimitBuckets.set(bucketKey, next);

  if (next > RATE_LIMIT_MAX_REQUESTS) {
    return { limited: true, remaining: 0 };
  }

  if (rateLimitBuckets.size > 2000) {
    const minTick = Math.floor(now / RATE_LIMIT_WINDOW_MS) - 2;
    for (const key of rateLimitBuckets.keys()) {
      const parts = key.split("|");
      const tick = Number(parts[parts.length - 1]);
      if (tick < minTick) rateLimitBuckets.delete(key);
    }
  }

  return { limited: false, remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - next) };
}

function applySecurityHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  const host = String(req.headers.host || "");
  if (host && !/localhost|127\.0\.0\.1/i.test(host)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function getStatusClass(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return "2xx";
  if (statusCode >= 400 && statusCode < 500) return "4xx";
  if (statusCode >= 500 && statusCode < 600) return "5xx";
  return "other";
}

function normalizeMetricPath(pathname) {
  return String(pathname || "")
    .replace(/^\/api\/stripe\/charges\/[^/]+$/, "/api/stripe/charges/:id")
    .replace(/^\/api\/braintree\/payments\/[^/]+$/, "/api/braintree/payments/:id")
    .replace(/^\/api\/braintree\/transaction\/[^/]+$/, "/api/braintree/transaction/:id");
}

function recordMetrics(method, pathname, statusCode, durationMs) {
  if (!METRICS_ENABLED) return;

  metricsState.totalRequests += 1;
  const statusClass = getStatusClass(statusCode);
  metricsState.byStatusClass[statusClass] += 1;

  const route = `${String(method || "GET").toUpperCase()} ${normalizeMetricPath(pathname)}`;
  const current = metricsState.routes.get(route) || {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastStatus: 0,
    lastAt: 0
  };

  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.lastStatus = statusCode;
  current.lastAt = Date.now();
  metricsState.routes.set(route, current);
}

function metricsSnapshot() {
  const topRoutes = Array.from(metricsState.routes.entries())
    .map(([route, data]) => ({
      route,
      count: data.count,
      avg_ms: data.count ? Number((data.totalMs / data.count).toFixed(2)) : 0,
      max_ms: data.maxMs,
      last_status: data.lastStatus,
      last_at: data.lastAt
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  return {
    enabled: METRICS_ENABLED,
    started_at: metricsState.startedAt,
    uptime_ms: Date.now() - metricsState.startedAt,
    total_requests: metricsState.totalRequests,
    by_status_class: metricsState.byStatusClass,
    routes: topRoutes
  };
}

const sessions = new Map();
const wallets = new Map();

// Amazon API In-Memory Database
const amazonUsers = new Map();
const amazonCarts = new Map();
const amazonOrders = new Map();
let amazonUserIdCounter = 1;
let amazonCartIdCounter = 1;
let amazonOrderIdCounter = 1;

// Sample products data for Amazon API
const amazonProducts = [
  {
    _id: "61b19d07fb9b1f6eeaaee436",
    name: "Nori Sea Weed",
    price: 432,
    rating: 4.4,
    category: "Grocery",
    description: "Etiam pretium iaculis justo. In hac habitasse platea dictumst. Etiam faucibus cursus.",
    imageURL: "https://freepngimg.com/download/grocery/41637-4-groceries-free-hd-image.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.522Z"),
    updatedAt: new Date("2021-12-09T06:14:12.029Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee437",
    name: "Onions - Red Pearl",
    price: 109,
    rating: 3.8,
    category: "Grocery",
    description: "Duis aliquam convallis nunc. Proin at turpis a pede posuere nonummy.",
    imageURL: "https://freepngimg.com/download/temp_png/41619-7-groceries-free-download-image_800x800.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.523Z"),
    updatedAt: new Date("2021-12-09T06:07:03.523Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee438",
    name: "Olives - Green, Pitted",
    price: 417,
    rating: 4.1,
    category: "Grocery",
    description: "Morbi non lectus. Aliquam sit amet diam in magna.",
    imageURL: "https://freepngimg.com/download/grocery/41622-3-groceries-download-free-png-hq.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.524Z"),
    updatedAt: new Date("2021-12-09T06:07:03.524Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee443",
    name: "Nori Sea Weed Premium",
    price: 455,
    rating: 1.1,
    category: "Grocery",
    description: "Premium quality nori sea weed for professional chefs.",
    imageURL: "https://www.seekpng.com/png/full/217-2174851_groceries-png.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.527Z"),
    updatedAt: new Date("2021-12-09T06:07:03.527Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee444",
    name: "Potatoes - Idaho 100 Count",
    price: 661,
    rating: 4.5,
    category: "Grocery",
    description: "Fresh Idaho potatoes, perfect for any meal.",
    imageURL: "https://www.seekpng.com/png/full/84-847327_grocery-png.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.528Z"),
    updatedAt: new Date("2021-12-09T06:07:03.528Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee446",
    name: "Dc - Frozen Momji",
    price: 827,
    rating: 3.9,
    category: "Frozen",
    description: "Delicious frozen Momji for quick meals.",
    imageURL: "https://www.pngitem.com/pimgs/b/521-5211858_grocery-png.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.529Z"),
    updatedAt: new Date("2021-12-09T06:07:03.529Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee447",
    name: "Flour - Semolina",
    price: 826,
    rating: 4.2,
    category: "Baking",
    description: "High-quality semolina flour for pasta and bread.",
    imageURL: "https://www.pngitem.com/pimgs/b/553-5532346_grocery-png.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.530Z"),
    updatedAt: new Date("2021-12-09T06:07:03.530Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee43a",
    name: "Rice - Brown",
    price: 234,
    rating: 4.6,
    category: "Grocery",
    description: "Organic brown rice, rich in fiber and nutrients.",
    imageURL: "https://www.pngitem.com/pimgs/b/520-5201776_grocery-png.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.525Z"),
    updatedAt: new Date("2021-12-09T06:07:03.525Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee43b",
    name: "Pasta - Penne",
    price: 178,
    rating: 4.3,
    category: "Grocery",
    description: "Italian penne pasta, perfect for any sauce.",
    imageURL: "https://www.pngitem.com/pimgs/b/494-4942895_groceries-png.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.526Z"),
    updatedAt: new Date("2021-12-09T06:07:03.526Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee43c",
    name: "Milk - Skim",
    price: 985,
    rating: 3.7,
    category: "Dairy",
    description: "Low-fat skim milk, healthy choice for the family.",
    imageURL: "https://www.pngitem.com/pimgs/b/494-4942895_groceries-png.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.527Z"),
    updatedAt: new Date("2021-12-09T06:07:03.527Z"),
    __v: 0
  },
  {
    _id: "61b19d07fb9b1f6eeaaee43f",
    name: "Sauce - Sesame Thai Dressing",
    price: 565,
    rating: 4.0,
    category: "Condiments",
    description: "Authentic Thai sesame dressing for salads and stir-fry.",
    imageURL: "https://www.pngitem.com/pimgs/b/520-5201776_grocery-png.png",
    inStock: true,
    createdAt: new Date("2021-12-09T06:07:03.528Z"),
    updatedAt: new Date("2021-12-09T06:07:03.528Z"),
    __v: 0
  }
];

const STATUS_MESSAGES = {
  APPROVED: "Payment accepted",
  AUTHORIZED: "Payment authorized",
  FORBIDDEN: "Operation forbidden",
  CONFLICT: "Request conflict",
  RATE_LIMITED: "Too many requests",
  EXTERNAL_DEPENDENCY_FAILED: "External dependency failed",
  INVALID_FORMAT: "Invalid format",
  TOKEN_CREATED: "Token generated",
  VERIFIED: "Verification successful",
  PENDING: "Transaction processing",
  PROCESSING: "Transaction processing",
  WAITING_CONFIRMATION: "Waiting for customer confirmation",
  DECLINED: "Transaction rejected",
  INVALID_CARD_NUMBER: "Card format invalid",
  INVALID_REQUEST: "Invalid request",
  AUTHENTICATION_REQUIRED: "Authentication needed",
  TOO_MANY_ATTEMPTS: "Too many attempts",
  VELOCITY_LIMIT: "Velocity limit reached",
  PROCESSOR_ERROR: "Payment processor error",
  GATEWAY_ERROR: "Gateway error",
  NETWORK_ERROR: "Network error",
  CONNECTION_FAILED: "Connection failed",
  SERVICE_UNAVAILABLE: "Service unavailable",
  SYSTEM_ERROR: "System error",
  UNKNOWN_ERROR: "Unknown error"
};

function statusMessage(code) {
  const key = String(code || "UNKNOWN_ERROR").toUpperCase();
  return STATUS_MESSAGES[key] || key.replaceAll("_", " ");
}

function statusPayload(code, reason) {
  return {
    status_code: code,
    status_message: statusMessage(code),
    reason
  };
}

function json(res, statusCode, payload) {
  const durationMs = Math.max(0, Date.now() - Number(res.__startTs || Date.now()));
  recordMetrics(res.__method, res.__path, statusCode, durationMs);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": res.__corsOrigin || "*",
    "Access-Control-Allow-Credentials": "false",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Accept,Authorization,Content-Type,Idempotency-Key,X-Stripe-Account,X-CL-Api-Base,X-CL-Access-Token,X-Sim-Cookie,X-Owner-Token,X-Access-Key,X-Request-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "X-Request-Id": res.__requestId || "n/a",
    "X-Response-Time-Ms": String(durationMs)
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function randHex(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

function signPayload(prefix, payloadObj) {
  const encoded = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const signature = sign(encoded);
  return `${prefix}${encoded}.${signature}`;
}

function verifySignedPayload(token, prefix) {
  if (!token || typeof token !== "string" || !token.startsWith(prefix)) {
    return { ok: false, reason: "Token missing or prefix invalid" };
  }

  const raw = token.slice(prefix.length);
  const parts = raw.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "Malformed token" };
  }

  const [encoded, signature] = parts;
  const expected = sign(encoded);
  if (signature !== expected) {
    return { ok: false, reason: "Signature mismatch" };
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (Date.now() > payload.exp) {
      return { ok: false, reason: "Token expired" };
    }
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, reason: "Invalid token payload" };
  }
}

function createOwnerToken(ownerUser) {
  return signPayload("ot_", {
    role: "owner",
    owner: ownerUser,
    iat: Date.now(),
    exp: Date.now() + OWNER_TOKEN_TTL_MS
  });
}

function verifyOwnerToken(token) {
  const v = verifySignedPayload(token, "ot_");
  if (!v.ok) return v;
  if (v.payload.role !== "owner") {
    return { ok: false, reason: "Owner role required" };
  }
  return { ok: true, payload: v.payload };
}

function createAccessKey(owner, profileId, ttlMinutes) {
  const ttl = Math.min(ACCESS_KEY_MAX_TTL_MINUTES, Math.max(ACCESS_KEY_MIN_TTL_MINUTES, ttlMinutes));
  return signPayload("ak_", {
    kind: "payments_access",
    owner,
    profileId,
    ttl_minutes: ttl,
    iat: Date.now(),
    exp: Date.now() + ttl * 60 * 1000
  });
}

function verifyAccessKey(token) {
  const v = verifySignedPayload(token, "ak_");
  if (!v.ok) return v;
  if (v.payload.kind !== "payments_access") {
    return { ok: false, reason: "Invalid key kind" };
  }
  return { ok: true, payload: v.payload };
}

function createSimCookie(region) {
  const payload = {
    sid: `sim_${randHex(8)}`,
    scope: "simulation-only",
    region,
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60
  };

  return signPayload("sim_", payload);
}

function verifySimCookie(token) {
  const v = verifySignedPayload(token, "sim_");
  if (!v.ok) {
    return { ok: false, reason: v.reason || "Missing or invalid simulation cookie" };
  }
  const payload = v.payload;

  if (payload.scope !== "simulation-only") {
    return { ok: false, reason: "Cookie scope is not simulation-only" };
  }
  if (Date.now() > payload.exp) {
    return { ok: false, reason: "Simulation cookie expired" };
  }

  return { ok: true, payload };
}

function luhnCheck(cardNumber) {
  const digits = String(cardNumber || "").replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function hashToInt(input) {
  const digest = crypto.createHash("sha256").update(String(input || "")).digest();
  return digest.readUInt32BE(0);
}

function scoreFromHash(input) {
  return hashToInt(input) % 100;
}

function buildCardSignals(cardNumber, session) {
  const seed = `${cardNumber}|${session.sid}|${session.uses}|${session.failedAttempts}`;
  const riskScore = scoreFromHash(seed);
  const avs = riskScore <= 65 ? "match" : riskScore <= 84 ? "partial" : "mismatch";
  const cvv = riskScore <= 72 ? "match" : "mismatch";
  const network = riskScore > 94 ? "unstable" : "ok";
  return { riskScore, avs, cvv, network };
}

function getRiskPolicy(mode) {
  if (mode === "strict") {
    return {
      mode: "strict",
      networkThreshold: 86,
      declineThreshold: 66,
      allowPartialAvs: false,
      requireCvvMatch: true
    };
  }

  return {
    mode: "balanced",
    networkThreshold: 88,
    declineThreshold: 74,
    allowPartialAvs: false,
    requireCvvMatch: true
  };
}

function getSessionByCookie(token) {
  const v = verifySimCookie(token);
  if (!v.ok) return { ok: false, reason: v.reason };

  const session = sessions.get(v.payload.sid);
  if (!session) return { ok: false, reason: "Session not found for cookie" };
  if (session.blocked) return { ok: false, reason: "Cookie blocked after failed attempts" };
  if (session.dead) return { ok: false, reason: "Cookie expired by usage policy" };

  return { ok: true, session, sid: v.payload.sid, payload: v.payload };
}

function toMinorAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function toMajorAmountString(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function getBraintreeTransactionId(pathname) {
  const withApi = pathname.match(/^\/api\/braintree\/transaction\/([^/]+)$/);
  if (withApi?.[1]) return decodeURIComponent(withApi[1]);
  const withoutApi = pathname.match(/^\/braintree\/transaction\/([^/]+)$/);
  if (withoutApi?.[1]) return decodeURIComponent(withoutApi[1]);
  return "";
}

function summarizeBraintreeErrors(result) {
  const errors = [];
  if (result?.errors?.deepErrors) {
    for (const err of result.errors.deepErrors()) {
      errors.push({
        attribute: err?.attribute || null,
        code: err?.code || null,
        message: err?.message || null
      });
    }
  }
  return errors;
}

function mapBraintreeFailure(result) {
  const message = result?.message || result?.transaction?.processorResponseText || "Braintree auth failed";
  const gatewayRejectionReason = String(result?.transaction?.gatewayRejectionReason || "").toLowerCase();
  const processorResponseCode = String(result?.transaction?.processorResponseCode || "");

  if (gatewayRejectionReason === "duplicate") {
    return { httpStatus: 409, statusCode: "CONFLICT", message };
  }
  if (gatewayRejectionReason === "avs" || gatewayRejectionReason === "cvv") {
    return { httpStatus: 402, statusCode: "DECLINED", message };
  }
  if (processorResponseCode === "2000" || processorResponseCode === "2010") {
    return { httpStatus: 402, statusCode: "DECLINED", message };
  }

  return { httpStatus: 402, statusCode: "PROCESSOR_ERROR", message };
}

function buildStripeRequestOptions(req, body = {}) {
  const idempotencyKeyHeader = String(req.headers["idempotency-key"] || "").trim();
  const stripeAccountHeader = String(req.headers["x-stripe-account"] || "").trim();
  const idempotencyKeyBody = String(body.idempotency_key || "").trim();
  const stripeAccountBody = String(body.stripe_account || "").trim();

  const idempotencyKey = idempotencyKeyHeader || idempotencyKeyBody;
  const stripeAccount = stripeAccountHeader || stripeAccountBody;
  const options = {};
  if (idempotencyKey) options.idempotencyKey = idempotencyKey;
  if (stripeAccount) options.stripeAccount = stripeAccount;
  return { options, idempotencyKey, stripeAccount };
}

function mapStripeError(error) {
  const type = String(error?.type || "api_error");
  const status = Number(error?.statusCode || error?.raw?.statusCode || 0);
  const message = error?.message || "Stripe request failed";
  const requestId = error?.requestId || error?.raw?.requestId || null;
  const code = error?.code || error?.raw?.code || null;
  const declineCode = error?.decline_code || error?.raw?.decline_code || null;
  const param = error?.param || error?.raw?.param || null;

  let statusCode = "PROCESSOR_ERROR";
  let httpStatus = status || 500;

  if (type === "card_error") {
    statusCode = "DECLINED";
    httpStatus = status || 402;
  } else if (type === "invalid_request_error") {
    statusCode = "INVALID_REQUEST";
    httpStatus = status || 400;
  } else if (type === "idempotency_error") {
    statusCode = "CONFLICT";
    httpStatus = status || 409;
  } else if (type === "authentication_error") {
    statusCode = "AUTHENTICATION_REQUIRED";
    httpStatus = status || 401;
  } else if (type === "api_connection_error") {
    statusCode = "CONNECTION_FAILED";
    httpStatus = status || 424;
  } else if (type === "rate_limit_error") {
    statusCode = "RATE_LIMITED";
    httpStatus = status || 429;
  } else if (type === "api_error") {
    statusCode = "PROCESSOR_ERROR";
    httpStatus = status || 502;
  }

  if (httpStatus === 403) statusCode = "FORBIDDEN";
  if (httpStatus === 404) statusCode = "INVALID_REQUEST";
  if (httpStatus >= 500) statusCode = "PROCESSOR_ERROR";

  return {
    httpStatus,
    statusCode,
    message,
    stripe: {
      type,
      request_id: requestId,
      code,
      decline_code: declineCode,
      param,
      http_status: httpStatus
    }
  };
}

function statusFromHttp(httpStatus) {
  if (httpStatus === 400 || httpStatus === 404) return "INVALID_REQUEST";
  if (httpStatus === 401) return "AUTHENTICATION_REQUIRED";
  if (httpStatus === 403) return "FORBIDDEN";
  if (httpStatus === 409) return "CONFLICT";
  if (httpStatus === 424) return "EXTERNAL_DEPENDENCY_FAILED";
  if (httpStatus === 429) return "RATE_LIMITED";
  if (httpStatus >= 500) return "PROCESSOR_ERROR";
  return "GATEWAY_ERROR";
}

function normalizeBaseUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getCommerceLayerAuth(req, body = {}) {
  const base = normalizeBaseUrl(req.headers["x-cl-api-base"] || body.cl_api_base || CL_API_BASE);
  const token = String(req.headers["x-cl-access-token"] || body.cl_access_token || CL_ACCESS_TOKEN || "").trim();
  return { base, token };
}

function getCommerceLayerPaymentId(pathname) {
  const withApi = pathname.match(/^\/api\/braintree\/payments\/([^/]+)$/);
  if (withApi?.[1]) return decodeURIComponent(withApi[1]);
  const withoutApi = pathname.match(/^\/braintree\/payments\/([^/]+)$/);
  if (withoutApi?.[1]) return decodeURIComponent(withoutApi[1]);
  return "";
}

function getStripeChargeId(pathname) {
  const withApi = pathname.match(/^\/api\/stripe\/charges\/([^/]+)$/);
  if (withApi?.[1]) return decodeURIComponent(withApi[1]);
  const withoutApi = pathname.match(/^\/stripe\/charges\/([^/]+)$/);
  if (withoutApi?.[1]) return decodeURIComponent(withoutApi[1]);
  return "";
}

async function commerceLayerRequest({ method, base, token, path, query = "", body = null }) {
  const endpoint = `${base}${path}${query ? `?${query}` : ""}`;
  const resp = await fetch(endpoint, {
    method,
    headers: {
      Accept: "application/vnd.api+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await resp.json();
  } catch (_) {
    data = null;
  }

  return { ok: resp.ok, status: resp.status, data };
}

async function getPayPalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  }

  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const resp = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  let data = null;
  try {
    data = await resp.json();
  } catch (error) {
    data = null;
  }

  if (!resp.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || `PayPal token error (${resp.status})`;
    throw new Error(reason);
  }

  return data.access_token;
}

const server = http.createServer(async (req, res) => {
  res.__requestId = crypto.randomUUID();
  res.__corsOrigin = resolveCorsOrigin(req.headers.origin);
  applySecurityHeaders(req, res);

  const rawUrl = String(req.url || "/");
  const url = new URL(rawUrl, `http://${req.headers.host || "localhost"}`);
  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
  res.__startTs = Date.now();
  res.__method = req.method;
  res.__path = normalizedPath;

  const limiter = consumeRateLimit(getClientIp(req), normalizedPath);
  if (limiter.limited) {
    json(res, 429, {
      ok: false,
      request_id: res.__requestId,
      ...statusPayload("RATE_LIMITED", "Too many requests in a short period")
    });
    return;
  }

  if (req.method === "OPTIONS") {
    json(res, 204, { ok: true, request_id: res.__requestId });
    return;
  }
  const pathIs = (...candidates) => candidates.includes(normalizedPath);

  try {
    if (req.method === "POST" && pathIs("/api/session/create", "/session/create")) {
      const accessKey = req.headers["x-access-key"];
      const keyValidation = verifyAccessKey(accessKey);
      if (!keyValidation.ok) {
        json(res, 403, {
          ok: false,
          ...statusPayload("AUTHENTICATION_REQUIRED", `Access key invalid: ${keyValidation.reason}`)
        });
        return;
      }

      const body = await parseBody(req);
      const region = body.region || "MX";
      const requestedRiskMode = String(body.risk_mode || "balanced").toLowerCase();
      const riskPolicy = getRiskPolicy(requestedRiskMode === "strict" ? "strict" : "balanced");
      const cookie = createSimCookie(region);
      const sid = JSON.parse(Buffer.from(cookie.slice(4).split(".")[0], "base64url").toString("utf8")).sid;

      sessions.set(sid, {
        sid,
        region,
        profileId: keyValidation.payload.profileId,
        uses: 0,
        failedAttempts: 0,
        blocked: false,
        dead: false,
        createdAt: Date.now(),
        riskMode: riskPolicy.mode
      });

      json(res, 200, {
        ok: true,
        ...statusPayload("TOKEN_CREATED", "simulation_session_created"),
        simulation_only: true,
        no_charge: true,
        cookie,
        key_profile: keyValidation.payload.profileId,
        policy: {
          max_uses: MAX_USES,
          max_failed_attempts: MAX_FAILED_ATTEMPTS,
          risk_mode: riskPolicy.mode,
          network_threshold: riskPolicy.networkThreshold,
          decline_threshold: riskPolicy.declineThreshold
        }
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/owner/login", "/owner/login")) {
      const body = await parseBody(req);
      const username = String(body.username || "");
      const password = String(body.password || "");

      if (username !== OWNER_USER || password !== OWNER_PASS) {
        json(res, 401, {
          ok: false,
          ...statusPayload("AUTHENTICATION_REQUIRED", "Owner credentials invalid")
        });
        return;
      }

      const ownerToken = createOwnerToken(username);
      json(res, 200, {
        ok: true,
        ...statusPayload("VERIFIED", "owner_authenticated"),
        owner: username,
        owner_token: ownerToken,
        expires_in_minutes: Math.floor(OWNER_TOKEN_TTL_MS / 60000)
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/owner/generate-key", "/owner/generate-key")) {
      const ownerToken = req.headers["x-owner-token"];
      const ownerValidation = verifyOwnerToken(ownerToken);
      if (!ownerValidation.ok) {
        json(res, 403, {
          ok: false,
          ...statusPayload("AUTHENTICATION_REQUIRED", `Owner token invalid: ${ownerValidation.reason}`)
        });
        return;
      }

      const body = await parseBody(req);
      const profileId = String(body.profile_id || "").trim();
      const ttlMinutes = Number(body.ttl_minutes || 30);
      if (!profileId) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "profile_id is required") });
        return;
      }

      const accessKey = createAccessKey(ownerValidation.payload.owner, profileId, ttlMinutes);
      const keyPayload = verifyAccessKey(accessKey).payload;

      json(res, 200, {
        ok: true,
        ...statusPayload("TOKEN_CREATED", "access_key_generated"),
        access_key: accessKey,
        profile_id: keyPayload.profileId,
        ttl_minutes: keyPayload.ttl_minutes,
        expires_at: keyPayload.exp,
        generated_by: keyPayload.owner
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/access-key/verify", "/access-key/verify")) {
      const body = await parseBody(req);
      const accessKey = String(body.access_key || "").trim();
      if (!accessKey) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "access_key is required") });
        return;
      }

      const validation = verifyAccessKey(accessKey);
      if (!validation.ok) {
        json(res, 200, {
          ok: false,
          ...statusPayload("AUTHENTICATION_REQUIRED", `Access key invalid: ${validation.reason}`)
        });
        return;
      }

      json(res, 200, {
        ok: true,
        ...statusPayload("VERIFIED", "access_key_verified"),
        profile_id: validation.payload.profileId,
        owner: validation.payload.owner,
        expires_at: validation.payload.exp
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/wallet/open", "/wallet/open")) {
      const token = req.headers["x-sim-cookie"];
      const auth = getSessionByCookie(token);
      if (!auth.ok) {
        json(res, 401, {
          ok: false,
          ...statusPayload("AUTHENTICATION_REQUIRED", auth.reason)
        });
        return;
      }

      const body = await parseBody(req);
      const walletId = `wallet_${randHex(6)}`;
      const wallet = {
        wallet_id: walletId,
        alias: body.alias || "Lab Wallet",
        state: "opened_no_charge",
        session_id: auth.sid,
        cards: []
      };
      wallets.set(walletId, wallet);
      json(res, 200, {
        ok: true,
        ...statusPayload("VERIFIED", "wallet_opened"),
        wallet,
        no_charge: true
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/wallet/associate-card", "/wallet/associate-card")) {
      const token = req.headers["x-sim-cookie"];
      const auth = getSessionByCookie(token);
      if (!auth.ok) {
        json(res, 401, {
          ok: false,
          ...statusPayload("AUTHENTICATION_REQUIRED", auth.reason)
        });
        return;
      }

      const body = await parseBody(req);
      const wallet = wallets.get(body.wallet_id);
      if (!wallet) {
        json(res, 404, { ok: false, ...statusPayload("INVALID_REQUEST", "Wallet not found") });
        return;
      }
      if (wallet.session_id !== auth.sid) {
        json(res, 403, {
          ok: false,
          ...statusPayload("AUTHENTICATION_REQUIRED", "Wallet does not belong to this simulation session")
        });
        return;
      }

      auth.session.uses += 1;
      if (auth.session.uses > MAX_USES) {
        auth.session.dead = true;
        json(res, 403, {
          ok: false,
          result: "REJECTED",
          ...statusPayload("VELOCITY_LIMIT", "Cookie expired by usage policy"),
          verifier: {
            uses: auth.session.uses,
            failed_attempts: auth.session.failedAttempts,
            blocked: auth.session.blocked,
            dead: auth.session.dead
          }
        });
        return;
      }

      const cardNumber = String(body.card_number || "").replace(/\s+/g, "");
      const luhnValid = luhnCheck(cardNumber);
      const signals = buildCardSignals(cardNumber, auth.session);
      const simulatedLatencyMs = 90 + (signals.riskScore % 180);
      const riskPolicy = getRiskPolicy(auth.session.riskMode || "balanced");

      if (!luhnValid) {
        auth.session.failedAttempts += 1;
        if (auth.session.failedAttempts >= MAX_FAILED_ATTEMPTS) {
          auth.session.blocked = true;
        }

        json(res, 200, {
          ok: false,
          no_charge: true,
          result: "REJECTED",
          ...statusPayload("INVALID_CARD_NUMBER", "invalid_card_luhn"),
          decision: {
            risk_score: signals.riskScore,
            avs: signals.avs,
            cvv: signals.cvv,
            network: signals.network,
            latency_ms: simulatedLatencyMs,
            confidence: "synthetic_high",
            policy_mode: riskPolicy.mode
          },
          verifier: {
            uses: auth.session.uses,
            failed_attempts: auth.session.failedAttempts,
            blocked: auth.session.blocked,
            dead: auth.session.dead
          }
        });
        return;
      }

      if (signals.riskScore >= riskPolicy.networkThreshold) {
        json(res, 200, {
          ok: false,
          no_charge: true,
          result: "REJECTED",
          ...statusPayload("NETWORK_ERROR", "simulated_network_instability"),
          decision: {
            risk_score: signals.riskScore,
            avs: signals.avs,
            cvv: signals.cvv,
            network: signals.network,
            latency_ms: simulatedLatencyMs,
            confidence: "synthetic_high",
            policy_mode: riskPolicy.mode
          },
          verifier: {
            uses: auth.session.uses,
            failed_attempts: auth.session.failedAttempts,
            blocked: auth.session.blocked,
            dead: auth.session.dead
          }
        });
        return;
      }

      const avsFail = signals.avs === "mismatch" || (!riskPolicy.allowPartialAvs && signals.avs === "partial");
      const cvvFail = riskPolicy.requireCvvMatch && signals.cvv !== "match";
      const riskFail = signals.riskScore >= riskPolicy.declineThreshold;

      if (riskFail || avsFail || cvvFail) {
        auth.session.failedAttempts += 1;
        if (auth.session.failedAttempts >= MAX_FAILED_ATTEMPTS) {
          auth.session.blocked = true;
        }
        json(res, 200, {
          ok: false,
          no_charge: true,
          result: "REJECTED",
          ...statusPayload("RISK_DECLINED", "risk_policy_decline"),
          decision: {
            risk_score: signals.riskScore,
            avs: signals.avs,
            cvv: signals.cvv,
            network: signals.network,
            latency_ms: simulatedLatencyMs,
            confidence: "synthetic_high",
            policy_mode: riskPolicy.mode,
            fail_flags: {
              risk: riskFail,
              avs: avsFail,
              cvv: cvvFail
            }
          },
          verifier: {
            uses: auth.session.uses,
            failed_attempts: auth.session.failedAttempts,
            blocked: auth.session.blocked,
            dead: auth.session.dead
          }
        });
        return;
      }

      auth.session.failedAttempts = 0;
      const cardRef = {
        id: `card_${randHex(5)}`,
        last4: cardNumber.slice(-4),
        createdAt: Date.now(),
        method: "amazon_like_no_cvv_mock"
      };

      wallet.cards.push(cardRef);
      wallet.state = "card_associated";

      json(res, 200, {
        ok: true,
        no_charge: true,
        result: "AUTHORIZED",
        ...statusPayload("APPROVED", "association_test_passed"),
        decision: {
          risk_score: signals.riskScore,
          avs: signals.avs,
          cvv: signals.cvv,
          network: signals.network,
          latency_ms: simulatedLatencyMs,
          confidence: "synthetic_high",
          policy_mode: riskPolicy.mode
        },
        wallet_id: wallet.wallet_id,
        card: cardRef,
        verifier: {
          uses: auth.session.uses,
          failed_attempts: auth.session.failedAttempts,
          blocked: auth.session.blocked,
          dead: auth.session.dead
        }
      });
      return;
    }

    if (req.method === "GET" && pathIs("/api/health", "/health")) {
      json(res, 200, {
        ok: true,
        ...statusPayload("VERIFIED", "service_healthy"),
        service: "cookie-lab-api",
        mode: "simulation-only"
      });
      return;
    }

    if (req.method === "GET" && pathIs("/api/metrics", "/metrics")) {
      json(res, 200, {
        ok: true,
        ...statusPayload("VERIFIED", "metrics_snapshot"),
        metrics: metricsSnapshot()
      });
      return;
    }

    if (req.method === "GET" && pathIs("/api/stripe/config", "/stripe/config")) {
      json(res, 200, {
        ok: true,
        enabled: Boolean(stripe),
        publishable_key: STRIPE_PUBLISHABLE_KEY || "",
        network: {
          timeout_ms: Number.isFinite(STRIPE_TIMEOUT_MS) ? STRIPE_TIMEOUT_MS : 5000,
          max_network_retries: Number.isFinite(STRIPE_MAX_NETWORK_RETRIES) ? STRIPE_MAX_NETWORK_RETRIES : 3
        }
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/stripe/setup-intent", "/stripe/setup-intent")) {
      if (!stripe) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const customer = String(body.customer || "").trim();
      const usage = String(body.usage || "off_session").trim();
      const { options: stripeReqOptions, idempotencyKey, stripeAccount } = buildStripeRequestOptions(req, body);

      try {
        const setupIntent = await stripe.setupIntents.create(
          {
            customer: customer || undefined,
            usage: usage === "on_session" ? "on_session" : "off_session",
            payment_method_types: ["card"],
            metadata: {
              source: "cookie-lab",
              gate: "stripe-setup-intent",
              ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {})
            }
          },
          stripeReqOptions
        );

        json(res, 200, {
          ok: true,
          ...statusPayload("PENDING", "setup_intent_created"),
          id: setupIntent.id,
          client_secret: setupIntent.client_secret,
          status: setupIntent.status,
          stripe: {
            request_id: setupIntent?.lastResponse?.requestId || null,
            idempotency_key: idempotencyKey || null,
            stripe_account: stripeAccount || null
          }
        });
      } catch (error) {
        const mapped = mapStripeError(error);
        json(res, mapped.httpStatus, {
          ok: false,
          ...statusPayload(mapped.statusCode, mapped.message),
          error_type: mapped.stripe.type,
          stripe: mapped.stripe
        });
      }
      return;
    }

    if (req.method === "POST" && pathIs("/api/stripe/customer", "/stripe/customer")) {
      if (!stripe) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const customerId = String(body.customer_id || "").trim();
      const email = String(body.email || "").trim();
      const name = String(body.name || "").trim();
      const { options: stripeReqOptions, idempotencyKey, stripeAccount } = buildStripeRequestOptions(req, body);

      try {
        let customer = null;
        if (customerId) {
          customer = await stripe.customers.retrieve(customerId, stripeReqOptions);
          if (!customer || customer.deleted) {
            json(res, 404, { ok: false, ...statusPayload("INVALID_REQUEST", "Customer not found") });
            return;
          }
          json(res, 200, {
            ok: true,
            ...statusPayload("VERIFIED", "customer_loaded"),
            customer,
            stripe: {
              request_id: customer?.lastResponse?.requestId || null,
              idempotency_key: idempotencyKey || null,
              stripe_account: stripeAccount || null
            }
          });
          return;
        }

        if (!email) {
          json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "email or customer_id is required") });
          return;
        }

        customer = await stripe.customers.create(
          {
            email,
            name: name || undefined,
            metadata: {
              source: "cookie-lab",
              gate: "stripe-customer",
              ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {})
            }
          },
          stripeReqOptions
        );

        json(res, 200, {
          ok: true,
          ...statusPayload("AUTHORIZED", "customer_created"),
          customer,
          stripe: {
            request_id: customer?.lastResponse?.requestId || null,
            idempotency_key: idempotencyKey || null,
            stripe_account: stripeAccount || null
          }
        });
      } catch (error) {
        const mapped = mapStripeError(error);
        json(res, mapped.httpStatus, {
          ok: false,
          ...statusPayload(mapped.statusCode, mapped.message),
          error_type: mapped.stripe.type,
          stripe: mapped.stripe
        });
      }
      return;
    }

    if (req.method === "POST" && pathIs("/api/stripe/payment-method/attach", "/stripe/payment-method/attach")) {
      if (!stripe) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const customer = String(body.customer || "").trim();
      const paymentMethod = String(body.payment_method || "").trim();
      const { options: stripeReqOptions, idempotencyKey, stripeAccount } = buildStripeRequestOptions(req, body);

      if (!customer || !paymentMethod) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "customer and payment_method are required") });
        return;
      }

      try {
        const attached = await stripe.paymentMethods.attach(
          paymentMethod,
          { customer },
          stripeReqOptions
        );

        json(res, 200, {
          ok: true,
          ...statusPayload("AUTHORIZED", "payment_method_attached"),
          payment_method: attached,
          stripe: {
            request_id: attached?.lastResponse?.requestId || null,
            idempotency_key: idempotencyKey || null,
            stripe_account: stripeAccount || null
          }
        });
      } catch (error) {
        const mapped = mapStripeError(error);
        json(res, mapped.httpStatus, {
          ok: false,
          ...statusPayload(mapped.statusCode, mapped.message),
          error_type: mapped.stripe.type,
          stripe: mapped.stripe
        });
      }
      return;
    }

    if (req.method === "POST" && pathIs("/api/stripe/offsession-charge", "/stripe/offsession-charge")) {
      if (!stripe) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const amountMinor = toMinorAmount(body.amount);
      const currency = String(body.currency || "usd").toLowerCase();
      const customer = String(body.customer || "").trim();
      const paymentMethod = String(body.payment_method || "").trim();
      const description = String(body.description || "Cookie Lab Stripe Off-session Charge");
      const { options: stripeReqOptions, idempotencyKey, stripeAccount } = buildStripeRequestOptions(req, body);

      if (!amountMinor) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_REQUEST", "Invalid amount") });
        return;
      }
      if (!/^[a-z]{3}$/.test(currency)) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_FORMAT", "Invalid currency format") });
        return;
      }
      if (!customer || !paymentMethod) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "customer and payment_method are required") });
        return;
      }

      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: amountMinor,
            currency,
            customer,
            payment_method: paymentMethod,
            off_session: true,
            confirm: true,
            description,
            metadata: {
              source: "cookie-lab",
              gate: "stripe-offsession",
              ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {})
            }
          },
          stripeReqOptions
        );

        json(res, 200, {
          ok: true,
          ...statusPayload(intent.status === "succeeded" ? "APPROVED" : "PENDING", "offsession_payment_intent_created"),
          id: intent.id,
          status: intent.status,
          amount: intent.amount,
          currency: intent.currency,
          latest_charge: intent.latest_charge || null,
          stripe: {
            request_id: intent?.lastResponse?.requestId || null,
            idempotency_key: idempotencyKey || null,
            stripe_account: stripeAccount || null
          }
        });
      } catch (error) {
        const mapped = mapStripeError(error);
        json(res, mapped.httpStatus, {
          ok: false,
          ...statusPayload(mapped.statusCode, mapped.message),
          error_type: mapped.stripe.type,
          stripe: mapped.stripe
        });
      }
      return;
    }

    if (req.method === "POST" && pathIs("/api/stripe/create-intent", "/stripe/create-intent")) {
      if (!stripe) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const amountMinor = toMinorAmount(body.amount);
      const currency = String(body.currency || "usd").toLowerCase();
      const email = String(body.email || "").trim();
      const { options: stripeReqOptions, idempotencyKey, stripeAccount } = buildStripeRequestOptions(req, body);

      if (!amountMinor) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_REQUEST", "Invalid amount") });
        return;
      }

      if (!/^[a-z]{3}$/.test(currency)) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_FORMAT", "Invalid currency format") });
        return;
      }

      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: amountMinor,
            currency,
            payment_method_types: ["card"],
            receipt_email: email || undefined,
            description: "Cookie Lab Stripe Auth (test)",
            metadata: {
              source: "cookie-lab",
              gate: "stripe-auth",
              ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {})
            }
          },
          stripeReqOptions
        );

        json(res, 200, {
          ok: true,
          ...statusPayload("PENDING", "payment_intent_created"),
          id: intent.id,
          client_secret: intent.client_secret,
          amount: intent.amount,
          currency: intent.currency,
          status: intent.status,
          stripe: {
            request_id: intent?.lastResponse?.requestId || null,
            idempotency_key: idempotencyKey || null,
            stripe_account: stripeAccount || null
          }
        });
      } catch (error) {
        const mapped = mapStripeError(error);
        json(res, mapped.httpStatus, {
          ok: false,
          ...statusPayload(mapped.statusCode, mapped.message),
          error_type: mapped.stripe.type,
          stripe: mapped.stripe
        });
      }
      return;
    }

    if (req.method === "POST" && pathIs("/api/stripe/create-charge", "/stripe/create-charge")) {
      if (!stripe) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const amountMinor = toMinorAmount(body.amount);
      const currency = String(body.currency || "usd").toLowerCase();
      const source = String(body.source || "").trim();
      const customer = String(body.customer || "").trim();
      const description = String(body.description || "Cookie Lab Stripe Charge");
      const { options: stripeReqOptions, idempotencyKey, stripeAccount } = buildStripeRequestOptions(req, body);

      if (!amountMinor) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_REQUEST", "Invalid amount") });
        return;
      }
      if (!/^[a-z]{3}$/.test(currency)) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_FORMAT", "Invalid currency format") });
        return;
      }
      if (!source && !customer) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "source or customer is required") });
        return;
      }

      try {
        const charge = await stripe.charges.create(
          {
            amount: amountMinor,
            currency,
            source: source || undefined,
            customer: customer || undefined,
            capture: body.capture !== false,
            description,
            metadata: {
              source: "cookie-lab",
              gate: "stripe-charge",
              ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {})
            }
          },
          stripeReqOptions
        );

        json(res, 200, {
          ok: Boolean(charge?.paid),
          ...statusPayload(charge?.paid ? "APPROVED" : "PENDING", "stripe_charge_created"),
          id: charge.id,
          status: charge.status,
          paid: Boolean(charge.paid),
          amount: charge.amount,
          currency: charge.currency,
          outcome: charge.outcome || null,
          stripe: {
            request_id: charge?.lastResponse?.requestId || null,
            idempotency_key: idempotencyKey || null,
            stripe_account: stripeAccount || null
          }
        });
      } catch (error) {
        const mapped = mapStripeError(error);
        json(res, mapped.httpStatus, {
          ok: false,
          ...statusPayload(mapped.statusCode, mapped.message),
          error_type: mapped.stripe.type,
          stripe: mapped.stripe
        });
      }

      return;
    }

    const stripeChargeId = getStripeChargeId(normalizedPath);
    if (req.method === "GET" && stripeChargeId) {
      if (!stripe) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY."
          )
        });
        return;
      }

      const body = {};
      const { options: stripeReqOptions, idempotencyKey, stripeAccount } = buildStripeRequestOptions(req, body);
      try {
        const charge = await stripe.charges.retrieve(
          stripeChargeId,
          { expand: ["balance_transaction"] },
          stripeReqOptions
        );

        json(res, 200, {
          ok: true,
          ...statusPayload("VERIFIED", "stripe_charge_loaded"),
          charge,
          stripe: {
            request_id: charge?.lastResponse?.requestId || null,
            idempotency_key: idempotencyKey || null,
            stripe_account: stripeAccount || null
          }
        });
      } catch (error) {
        const mapped = mapStripeError(error);
        json(res, mapped.httpStatus, {
          ok: false,
          ...statusPayload(mapped.statusCode, mapped.message),
          error_type: mapped.stripe.type,
          stripe: mapped.stripe
        });
      }
      return;
    }

    if (req.method === "GET" && pathIs("/api/braintree/config", "/braintree/config")) {
      json(res, 200, {
        ok: true,
        enabled: Boolean(btGateway),
        environment: BT_ENV,
        merchant_account_id: BT_MERCHANT_ACCOUNT_ID || null,
        submit_for_settlement_default: BT_DEFAULT_SUBMIT_FOR_SETTLEMENT,
        commerce_layer: {
          enabled: Boolean(CL_API_BASE && CL_ACCESS_TOKEN),
          api_base: normalizeBaseUrl(CL_API_BASE) || null
        }
      });
      return;
    }

    if (req.method === "GET" && pathIs("/api/braintree/payments", "/braintree/payments")) {
      const auth = getCommerceLayerAuth(req);
      if (!auth.base || !auth.token) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Commerce Layer is not configured. Set CL_API_BASE and CL_ACCESS_TOKEN (or send X-CL-* headers)."
          )
        });
        return;
      }

      const allowedFilters = ["id", "created_at", "updated_at", "reference", "reference_origin", "metadata", "order"];
      const params = new URLSearchParams();
      for (const field of allowedFilters) {
        const value = String(url.searchParams.get(`filter[${field}]`) || "").trim();
        if (value) params.set(`filter[${field}]`, value);
      }

      const include = String(url.searchParams.get("include") || "").trim();
      if (include) params.set("include", include);

      const pageNumber = String(url.searchParams.get("page[number]") || "").trim();
      const pageSize = String(url.searchParams.get("page[size]") || "").trim();
      if (pageNumber) params.set("page[number]", pageNumber);
      if (pageSize) params.set("page[size]", pageSize);

      const clResp = await commerceLayerRequest({
        method: "GET",
        base: auth.base,
        token: auth.token,
        path: "/api/braintree_payments",
        query: params.toString()
      });

      if (!clResp.ok) {
        json(res, clResp.status, {
          ok: false,
          ...statusPayload(statusFromHttp(clResp.status), clResp.data?.errors?.[0]?.detail || "Commerce Layer list failed"),
          raw: clResp.data || null
        });
        return;
      }

      json(res, 200, {
        ok: true,
        ...statusPayload("VERIFIED", "commerce_layer_braintree_payments_listed"),
        data: clResp.data
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/braintree/payments", "/braintree/payments")) {
      const body = await parseBody(req);
      const auth = getCommerceLayerAuth(req, body);
      if (!auth.base || !auth.token) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Commerce Layer is not configured. Set CL_API_BASE and CL_ACCESS_TOKEN (or send X-CL-* headers)."
          )
        });
        return;
      }

      const orderId = String(body.order_id || body?.data?.relationships?.order?.data?.id || "").trim();
      if (!orderId) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "order_id is required") });
        return;
      }

      const payload = {
        data: {
          type: "braintree_payments",
          relationships: {
            order: {
              data: {
                type: "orders",
                id: orderId
              }
            }
          }
        }
      };

      const reference = String(body.reference || "").trim();
      const referenceOrigin = String(body.reference_origin || "").trim();
      const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : null;
      if (reference || referenceOrigin || metadata) {
        payload.data.attributes = {};
        if (reference) payload.data.attributes.reference = reference;
        if (referenceOrigin) payload.data.attributes.reference_origin = referenceOrigin;
        if (metadata) payload.data.attributes.metadata = metadata;
      }

      const clResp = await commerceLayerRequest({
        method: "POST",
        base: auth.base,
        token: auth.token,
        path: "/api/braintree_payments",
        body: payload
      });

      if (!clResp.ok) {
        json(res, clResp.status, {
          ok: false,
          ...statusPayload(statusFromHttp(clResp.status), clResp.data?.errors?.[0]?.detail || "Commerce Layer create failed"),
          raw: clResp.data || null
        });
        return;
      }

      json(res, 200, {
        ok: true,
        ...statusPayload("PENDING", "commerce_layer_braintree_payment_created"),
        data: clResp.data
      });
      return;
    }

    const paymentId = getCommerceLayerPaymentId(normalizedPath);
    if (paymentId && req.method === "GET") {
      const auth = getCommerceLayerAuth(req);
      if (!auth.base || !auth.token) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Commerce Layer is not configured. Set CL_API_BASE and CL_ACCESS_TOKEN (or send X-CL-* headers)."
          )
        });
        return;
      }

      const clResp = await commerceLayerRequest({
        method: "GET",
        base: auth.base,
        token: auth.token,
        path: `/api/braintree_payments/${encodeURIComponent(paymentId)}`
      });

      if (!clResp.ok) {
        json(res, clResp.status, {
          ok: false,
          ...statusPayload(statusFromHttp(clResp.status), clResp.data?.errors?.[0]?.detail || "Commerce Layer get failed"),
          raw: clResp.data || null
        });
        return;
      }

      json(res, 200, {
        ok: true,
        ...statusPayload("VERIFIED", "commerce_layer_braintree_payment_loaded"),
        data: clResp.data
      });
      return;
    }

    if (paymentId && req.method === "PATCH") {
      const body = await parseBody(req);
      const auth = getCommerceLayerAuth(req, body);
      if (!auth.base || !auth.token) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Commerce Layer is not configured. Set CL_API_BASE and CL_ACCESS_TOKEN (or send X-CL-* headers)."
          )
        });
        return;
      }

      const attributes = {};
      const nonce = String(body.payment_method_nonce || "").trim();
      const paymentMethodId = String(body.payment_id || "").trim();
      const reference = String(body.reference || "").trim();
      const referenceOrigin = String(body.reference_origin || "").trim();
      if (nonce) attributes.payment_method_nonce = nonce;
      if (paymentMethodId) attributes.payment_id = paymentMethodId;
      if (typeof body.local === "boolean") attributes.local = body.local;
      if (body.options && typeof body.options === "object") attributes.options = body.options;
      if (reference) attributes.reference = reference;
      if (referenceOrigin) attributes.reference_origin = referenceOrigin;
      if (body.metadata && typeof body.metadata === "object") attributes.metadata = body.metadata;

      const payload = {
        data: {
          type: "braintree_payments",
          id: paymentId
        }
      };

      if (Object.keys(attributes).length > 0) {
        payload.data.attributes = attributes;
      }

      const orderId = String(body.order_id || body?.relationships?.order?.data?.id || "").trim();
      if (orderId) {
        payload.data.relationships = {
          order: {
            data: {
              type: "orders",
              id: orderId
            }
          }
        };
      }

      const clResp = await commerceLayerRequest({
        method: "PATCH",
        base: auth.base,
        token: auth.token,
        path: `/api/braintree_payments/${encodeURIComponent(paymentId)}`,
        body: payload
      });

      if (!clResp.ok) {
        json(res, clResp.status, {
          ok: false,
          ...statusPayload(statusFromHttp(clResp.status), clResp.data?.errors?.[0]?.detail || "Commerce Layer patch failed"),
          raw: clResp.data || null
        });
        return;
      }

      json(res, 200, {
        ok: true,
        ...statusPayload("AUTHORIZED", "commerce_layer_braintree_payment_updated"),
        data: clResp.data
      });
      return;
    }

    if (req.method === "GET" && pathIs("/api/paypal/config", "/paypal/config")) {
      json(res, 200, {
        ok: true,
        enabled: Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET),
        mode: PAYPAL_MODE,
        api_base: PAYPAL_API_BASE
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/paypal/create-payment", "/paypal/create-payment")) {
      if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const amount = toMajorAmountString(body.amount);
      const currency = String(body.currency || "USD").toUpperCase();
      const description = String(body.description || "Payment description");
      const returnUrl = String(body.return_url || "http://localhost/success");
      const cancelUrl = String(body.cancel_url || "http://localhost/cancel");
      const intent = String(body.intent || "sale").toLowerCase();

      if (!amount) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_REQUEST", "Invalid amount") });
        return;
      }

      if (!/^[A-Z]{3}$/.test(currency)) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_FORMAT", "Invalid currency format") });
        return;
      }

      const accessToken = await getPayPalAccessToken();
      const paymentResp = await fetch(`${PAYPAL_API_BASE}/v1/payments/payment`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: ["sale", "authorize", "order"].includes(intent) ? intent : "sale",
          payer: {
            payment_method: "paypal"
          },
          redirect_urls: {
            return_url: returnUrl,
            cancel_url: cancelUrl
          },
          transactions: [
            {
              amount: {
                total: amount,
                currency
              },
              description
            }
          ]
        })
      });

      let paymentData = null;
      try {
        paymentData = await paymentResp.json();
      } catch (error) {
        paymentData = null;
      }

      if (!paymentResp.ok || !paymentData?.id) {
        const reason = paymentData?.message || paymentData?.name || `PayPal create payment error (${paymentResp.status})`;
        json(res, 402, { ok: false, ...statusPayload("PROCESSOR_ERROR", reason), raw: paymentData || null });
        return;
      }

      const approvalUrl = Array.isArray(paymentData.links)
        ? paymentData.links.find((link) => link?.rel === "approval_url")?.href || null
        : null;

      json(res, 200, {
        ok: true,
        ...statusPayload("PENDING", "paypal_payment_created"),
        payment_id: paymentData.id,
        state: paymentData.state,
        intent: paymentData.intent,
        approval_url: approvalUrl,
        raw: paymentData
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/paypal/execute-payment", "/paypal/execute-payment")) {
      if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const paymentId = String(body.payment_id || "").trim();
      const payerId = String(body.payer_id || "").trim();
      if (!paymentId || !payerId) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "payment_id and payer_id are required") });
        return;
      }

      const accessToken = await getPayPalAccessToken();
      const execResp = await fetch(`${PAYPAL_API_BASE}/v1/payments/payment/${encodeURIComponent(paymentId)}/execute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ payer_id: payerId })
      });

      let execData = null;
      try {
        execData = await execResp.json();
      } catch (error) {
        execData = null;
      }

      if (!execResp.ok) {
        const reason = execData?.message || execData?.name || `PayPal execute error (${execResp.status})`;
        json(res, 402, { ok: false, ...statusPayload("PROCESSOR_ERROR", reason), raw: execData || null });
        return;
      }

      const state = String(execData?.state || "").toLowerCase();
      const approved = state === "approved";
      json(res, 200, {
        ok: approved,
        ...statusPayload(approved ? "APPROVED" : "PENDING", "paypal_payment_executed"),
        payment_id: execData?.id || paymentId,
        state: execData?.state || null,
        raw: execData
      });
      return;
    }

    if (req.method === "POST" && pathIs("/api/braintree/client-token", "/braintree/client-token")) {
      if (!btGateway) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Braintree is not configured. Set BT_MERCHANT_ID, BT_PUBLIC_KEY and BT_PRIVATE_KEY."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const customerId = String(body.customer_id || "").trim();
      const merchantAccountId = String(body.merchant_account_id || BT_MERCHANT_ACCOUNT_ID || "").trim();
      const tokenPayload = {};
      if (customerId) tokenPayload.customerId = customerId;
      if (merchantAccountId) tokenPayload.merchantAccountId = merchantAccountId;

      try {
        const tokenResult = await btGateway.clientToken.generate(tokenPayload);
        json(res, 200, {
          ok: true,
          ...statusPayload("TOKEN_CREATED", "braintree_client_token_generated"),
          client_token: tokenResult.clientToken,
          environment: BT_ENV,
          generated_for_customer: customerId || null,
          merchant_account_id: merchantAccountId || null
        });
      } catch (error) {
        json(res, 502, {
          ok: false,
          ...statusPayload("GATEWAY_ERROR", error?.message || "Braintree client token failed")
        });
      }
      return;
    }

    if (req.method === "POST" && pathIs("/api/braintree/checkout", "/braintree/checkout")) {
      if (!btGateway) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Braintree is not configured. Set BT_MERCHANT_ID, BT_PUBLIC_KEY and BT_PRIVATE_KEY."
          )
        });
        return;
      }

      const body = await parseBody(req);
      const nonce = String(body.payment_method_nonce || "").trim();
      const amount = toMajorAmountString(body.amount);
      const orderId = String(body.order_id || "").trim();
      const customerId = String(body.customer_id || "").trim();
      const merchantAccountId = String(body.merchant_account_id || BT_MERCHANT_ACCOUNT_ID || "").trim();
      const deviceData = String(body.device_data || "").trim();
      const submitForSettlement = toBoolean(body.submit_for_settlement, BT_DEFAULT_SUBMIT_FOR_SETTLEMENT);
      const storeInVaultOnSuccess = toBoolean(body.store_in_vault_on_success, false);
      const requireThreeDSecure = toBoolean(body.require_three_d_secure, false);
      if (!nonce) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "payment_method_nonce is required") });
        return;
      }
      if (!amount) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_REQUEST", "Invalid amount") });
        return;
      }

      const saleRequest = {
        amount,
        paymentMethodNonce: nonce,
        options: {
          submitForSettlement,
          storeInVaultOnSuccess,
          ...(requireThreeDSecure ? { threeDSecure: { required: true } } : {})
        }
      };

      if (orderId) saleRequest.orderId = orderId;
      if (customerId) saleRequest.customerId = customerId;
      if (merchantAccountId) saleRequest.merchantAccountId = merchantAccountId;
      if (deviceData) saleRequest.deviceData = deviceData;
      if (body.billing && typeof body.billing === "object") saleRequest.billing = body.billing;
      if (body.shipping && typeof body.shipping === "object") saleRequest.shipping = body.shipping;
      if (body.customer && typeof body.customer === "object") saleRequest.customer = body.customer;
      if (body.descriptor && typeof body.descriptor === "object") saleRequest.descriptor = body.descriptor;

      const sale = await btGateway.transaction.sale(saleRequest);

      if (!sale.success) {
        const mapped = mapBraintreeFailure(sale);
        json(res, mapped.httpStatus, {
          ok: false,
          ...statusPayload(mapped.statusCode, mapped.message),
          braintree: {
            gateway_rejection_reason: sale?.transaction?.gatewayRejectionReason || null,
            processor_response_code: sale?.transaction?.processorResponseCode || null,
            processor_response_text: sale?.transaction?.processorResponseText || null,
            cvv_response_code: sale?.transaction?.cvvResponseCode || null,
            avs_error_response_code: sale?.transaction?.avsErrorResponseCode || null,
            avs_street_address_response_code: sale?.transaction?.avsStreetAddressResponseCode || null,
            avs_postal_code_response_code: sale?.transaction?.avsPostalCodeResponseCode || null,
            errors: summarizeBraintreeErrors(sale)
          }
        });
        return;
      }

      json(res, 200, {
        ok: true,
        authorized: true,
        ...statusPayload("AUTHORIZED", "braintree_authorized"),
        transaction_id: sale.transaction.id,
        status: sale.transaction.status,
        amount: sale.transaction.amount,
        type: sale.transaction.type,
        merchant_account_id: sale.transaction.merchantAccountId || null,
        order_id: sale.transaction.orderId || null,
        processor_response_code: sale.transaction.processorResponseCode || null,
        processor_response_text: sale.transaction.processorResponseText || null,
        gateway_rejection_reason: sale.transaction.gatewayRejectionReason || null,
        three_d_secure: sale.transaction.threeDSecureInfo || null,
        risk_data: sale.transaction.riskData || null
      });
      return;
    }

    const btTransactionId = getBraintreeTransactionId(normalizedPath);
    if (req.method === "GET" && btTransactionId) {
      if (!btGateway) {
        json(res, 503, {
          ok: false,
          ...statusPayload(
            "SERVICE_UNAVAILABLE",
            "Braintree is not configured. Set BT_MERCHANT_ID, BT_PUBLIC_KEY and BT_PRIVATE_KEY."
          )
        });
        return;
      }

      try {
        const tx = await btGateway.transaction.find(btTransactionId);
        json(res, 200, {
          ok: true,
          ...statusPayload("VERIFIED", "braintree_transaction_loaded"),
          transaction: {
            id: tx.id,
            status: tx.status,
            amount: tx.amount,
            order_id: tx.orderId || null,
            type: tx.type,
            created_at: tx.createdAt || null,
            updated_at: tx.updatedAt || null,
            merchant_account_id: tx.merchantAccountId || null,
            processor_response_code: tx.processorResponseCode || null,
            processor_response_text: tx.processorResponseText || null,
            gateway_rejection_reason: tx.gatewayRejectionReason || null,
            cvv_response_code: tx.cvvResponseCode || null,
            avs_street_address_response_code: tx.avsStreetAddressResponseCode || null,
            avs_postal_code_response_code: tx.avsPostalCodeResponseCode || null,
            three_d_secure: tx.threeDSecureInfo || null,
            risk_data: tx.riskData || null
          }
        });
      } catch (error) {
        const reason = String(error?.message || "");
        const notFound = /not found/i.test(reason);
        json(res, notFound ? 404 : 502, {
          ok: false,
          ...statusPayload(notFound ? "INVALID_REQUEST" : "GATEWAY_ERROR", reason || "Braintree transaction lookup failed")
        });
      }
      return;
    }

    // Amazon API: POST /api/v1/signup
    if (req.method === "POST" && pathIs("/api/v1/signup", "/v1/signup")) {
      try {
        const body = await parseBody(req);
        const { name, email, password } = body || {};

        if (!name || !email || !password) {
          json(res, 400, { ok: false, error: "Name, email and password are required" });
          return;
        }

        // Check if user already exists
        for (const [_, user] of amazonUsers) {
          if (user.email === email) {
            json(res, 409, { ok: false, error: "User already exists" });
            return;
          }
        }

        const userId = `61b191c${String(amazonUserIdCounter++).padStart(10, "0")}`;
        const token = crypto.randomBytes(32).toString("hex");
        
        amazonUsers.set(userId, {
          _id: userId,
          name,
          email,
          password: crypto.createHash("sha256").update(password + SECRET).digest("hex"),
          token,
          createdAt: new Date()
        });

        json(res, 201, { token });
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    // Amazon API: POST /api/v1/login
    if (req.method === "POST" && pathIs("/api/v1/login", "/v1/login")) {
      try {
        const body = await parseBody(req);
        const { email, password } = body || {};

        if (!email || !password) {
          json(res, 400, { ok: false, error: "Email and password are required" });
          return;
        }

        const hashedPassword = crypto.createHash("sha256").update(password + SECRET).digest("hex");
        
        for (const [userId, user] of amazonUsers) {
          if (user.email === email && user.password === hashedPassword) {
            json(res, 200, { token: user.token });
            return;
          }
        }

        json(res, 401, { ok: false, error: "Invalid credentials" });
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    // Amazon API: GET /api/v1/products
    const productsPathMatch = normalizedPath.match(/^\/api\/v1\/products\/([a-f0-9]+)$/i);
    if (req.method === "GET" && productsPathMatch) {
      try {
        const productId = productsPathMatch[1];
        const product = amazonProducts.find(p => p._id === productId);
        if (!product) {
          json(res, 404, { ok: false, error: "Product not found" });
          return;
        }
        json(res, 200, product);
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    if (req.method === "GET" && pathIs("/api/v1/products", "/v1/products")) {
      try {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        const limit = Number(parsedUrl.searchParams.get("limit")) || 20;
        const page = Number(parsedUrl.searchParams.get("page")) || 1;
        const sort = parsedUrl.searchParams.get("sort") || "name";
        const name = parsedUrl.searchParams.get("name") || "";
        const category = parsedUrl.searchParams.get("category") || "";
        const inStock = parsedUrl.searchParams.get("inStock");
        const select = parsedUrl.searchParams.get("select") || "";
        const numericFilters = parsedUrl.searchParams.get("numericFilters") || "";

        let filtered = [...amazonProducts];

        if (name) {
          filtered = filtered.filter(p => p.name.toLowerCase().includes(name.toLowerCase()));
        }

        if (category) {
          filtered = filtered.filter(p => p.category.toLowerCase() === category.toLowerCase());
        }

        if (inStock === "true") {
          filtered = filtered.filter(p => p.inStock === true);
        } else if (inStock === "false") {
          filtered = filtered.filter(p => p.inStock === false);
        }

        if (numericFilters) {
          const filters = numericFilters.split(",");
          for (const filter of filters) {
            const match = filter.match(/^(\w+)(<|>|<=|>=|=)(\d+(\.\d+)?)$/);
            if (match) {
              const [, field, operator, value] = match;
              const numValue = Number(value);
              filtered = filtered.filter(p => {
                const fieldValue = p[field];
                if (typeof fieldValue !== "number") return true;
                switch (operator) {
                  case "<": return fieldValue < numValue;
                  case ">": return fieldValue > numValue;
                  case "<=": return fieldValue <= numValue;
                  case ">=": return fieldValue >= numValue;
                  case "=": return fieldValue === numValue;
                  default: return true;
                }
              });
            }
          }
        }

        filtered.sort((a, b) => {
          const aVal = a[sort];
          const bVal = b[sort];
          if (typeof aVal === "string") return aVal.localeCompare(bVal);
          return aVal - bVal;
        });

        const startIndex = (page - 1) * limit;
        const paginated = filtered.slice(startIndex, startIndex + limit);

        const selectFields = select.split(",").map(s => s.trim()).filter(Boolean);
        const result = paginated.map(product => {
          const productCopy = { ...product };
          selectFields.forEach(field => {
            if (field.startsWith("-")) {
              delete productCopy[field.substring(1)];
            }
          });
          return productCopy;
        });

        json(res, 200, { products: result, hits: filtered.length });
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    // Amazon API: GET /api/v1/orders
    if (req.method === "GET" && pathIs("/api/v1/orders", "/v1/orders")) {
      try {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (!token) {
          json(res, 401, { ok: false, error: "Authorization token required" });
          return;
        }

        let userId = null;
        for (const [id, user] of amazonUsers) {
          if (user.token === token) {
            userId = id;
            break;
          }
        }

        if (!userId) {
          json(res, 401, { ok: false, error: "Invalid token" });
          return;
        }

        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        const sort = parsedUrl.searchParams.get("sort") || "orderedAt";

        const userOrders = [];
        for (const [_, orderDoc] of amazonOrders) {
          if (orderDoc.createdBy === userId) {
            userOrders.push(...orderDoc.orders);
          }
        }

        if (sort === "orderedAt") {
          userOrders.sort((a, b) => new Date(a.orderedAt) - new Date(b.orderedAt));
        }

        const populatedOrders = userOrders.map(order => {
          const products = order.products.map(p => {
            const product = amazonProducts.find(prod => prod._id === p.productId);
            return {
              productId: p.productId,
              quantity: p.quantity,
              productName: product?.name || "Unknown",
              productPrice: product?.price || 0,
              productImage: product?.imageURL || ""
            };
          });

          return {
            ...order,
            products
          };
        });

        json(res, 200, { orders: populatedOrders });
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    // Amazon API: POST /api/v1/orders
    if (req.method === "POST" && pathIs("/api/v1/orders", "/v1/orders")) {
      try {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (!token) {
          json(res, 401, { ok: false, error: "Authorization token required" });
          return;
        }

        let userId = null;
        for (const [id, user] of amazonUsers) {
          if (user.token === token) {
            userId = id;
            break;
          }
        }

        if (!userId) {
          json(res, 401, { ok: false, error: "Invalid token" });
          return;
        }

        const body = await parseBody(req);
        const { products } = body || {};

        if (!products || !Array.isArray(products) || products.length === 0) {
          json(res, 400, { ok: false, error: "Products array is required" });
          return;
        }

        const orderId = `61b88e6${String(amazonOrderIdCounter++).padStart(10, "0")}`;
        const newOrderId = `61b88e6${String(amazonOrderIdCounter++).padStart(10, "0")}`;

        let userOrderDoc = null;
        for (const [_, doc] of amazonOrders) {
          if (doc.createdBy === userId) {
            userOrderDoc = doc;
            break;
          }
        }

        const newOrder = {
          products,
          orderedAt: new Date().toISOString(),
          orderStatus: "pending",
          _id: newOrderId
        };

        if (!userOrderDoc) {
          userOrderDoc = {
            _id: orderId,
            createdBy: userId,
            orders: [newOrder],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            __v: 0
          };
          amazonOrders.set(orderId, userOrderDoc);
        } else {
          userOrderDoc.orders.push(newOrder);
          userOrderDoc.updatedAt = new Date().toISOString();
          userOrderDoc.__v++;
        }

        json(res, 201, { userOrder: userOrderDoc });
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    // Amazon API: PATCH /api/v1/orders/:id
    const ordersPathMatch = normalizedPath.match(/^\/api\/v1\/orders\/([a-f0-9]+)$/i);
    if (req.method === "PATCH" && ordersPathMatch) {
      try {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (!token) {
          json(res, 401, { ok: false, error: "Authorization token required" });
          return;
        }

        let userId = null;
        for (const [id, user] of amazonUsers) {
          if (user.token === token) {
            userId = id;
            break;
          }
        }

        if (!userId) {
          json(res, 401, { ok: false, error: "Invalid token" });
          return;
        }

        const orderId = ordersPathMatch[1];
        const body = await parseBody(req);
        const { status } = body || {};

        if (!status) {
          json(res, 400, { ok: false, error: "Status is required" });
          return;
        }

        let found = false;
        for (const [_, orderDoc] of amazonOrders) {
          if (orderDoc.createdBy === userId) {
            for (const order of orderDoc.orders) {
              if (order._id === orderId) {
                order.orderStatus = status;
                order.lastUpdatedAt = new Date().toISOString();
                orderDoc.updatedAt = new Date().toISOString();
                found = true;
                json(res, 200, { userOrder: orderDoc });
                return;
              }
            }
          }
        }

        if (!found) {
          json(res, 404, { ok: false, error: "Order not found" });
        }
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    // Amazon API: GET /api/v1/cart
    if (req.method === "GET" && pathIs("/api/v1/cart", "/v1/cart")) {
      try {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (!token) {
          json(res, 401, { ok: false, error: "Authorization token required" });
          return;
        }

        let userId = null;
        for (const [id, user] of amazonUsers) {
          if (user.token === token) {
            userId = id;
            break;
          }
        }

        if (!userId) {
          json(res, 401, { ok: false, error: "Invalid token" });
          return;
        }

        for (const [_, cart] of amazonCarts) {
          if (cart.createdBy === userId) {
            json(res, 200, { cart });
            return;
          }
        }

        json(res, 404, { ok: false, error: "Cart not found" });
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    // Amazon API: POST /api/v1/cart
    if (req.method === "POST" && pathIs("/api/v1/cart", "/v1/cart")) {
      try {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (!token) {
          json(res, 401, { ok: false, error: "Authorization token required" });
          return;
        }

        let userId = null;
        for (const [id, user] of amazonUsers) {
          if (user.token === token) {
            userId = id;
            break;
          }
        }

        if (!userId) {
          json(res, 401, { ok: false, error: "Invalid token" });
          return;
        }

        const body = await parseBody(req);
        const { products } = body || {};

        if (!products || !Array.isArray(products)) {
          json(res, 400, { ok: false, error: "Products array is required" });
          return;
        }

        let cart = null;
        for (const [_, c] of amazonCarts) {
          if (c.createdBy === userId) {
            cart = c;
            break;
          }
        }

        const productsWithStock = products.map(p => ({
          ...p,
          stock: "In Stock"
        }));

        if (cart) {
          cart.products = productsWithStock;
          cart.__v++;
        } else {
          const cartId = `61bc27d${String(amazonCartIdCounter++).padStart(10, "0")}`;
          cart = {
            createdBy: userId,
            _id: cartId,
            products: productsWithStock,
            __v: 0
          };
          amazonCarts.set(cartId, cart);
        }

        json(res, 200, { cart });
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    // Amazon API: DELETE /api/v1/cart/:productId
    const cartPathMatch = normalizedPath.match(/^\/api\/v1\/cart\/([a-f0-9]+)$/i);
    if (req.method === "DELETE" && cartPathMatch) {
      try {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (!token) {
          json(res, 401, { ok: false, error: "Authorization token required" });
          return;
        }

        let userId = null;
        for (const [id, user] of amazonUsers) {
          if (user.token === token) {
            userId = id;
            break;
          }
        }

        if (!userId) {
          json(res, 401, { ok: false, error: "Invalid token" });
          return;
        }

        const productId = cartPathMatch[1];

        for (const [_, cart] of amazonCarts) {
          if (cart.createdBy === userId) {
            cart.products = cart.products.filter(p => p.productId !== productId);
            cart.__v++;
            json(res, 200, { cart });
            return;
          }
        }

        json(res, 404, { ok: false, error: "Cart not found" });
      } catch (error) {
        json(res, 500, { ok: false, error: error.message || "Internal error" });
      }
      return;
    }

    json(res, 404, { ok: false, request_id: res.__requestId, ...statusPayload("INVALID_REQUEST", "Not found") });
  } catch (error) {
    json(res, 500, {
      ok: false,
      request_id: res.__requestId,
      ...statusPayload("SYSTEM_ERROR", error.message || "Internal error")
    });
  }
});

server.requestTimeout = Math.max(5_000, Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 15_000));
server.headersTimeout = Math.max(10_000, Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 20_000));
server.keepAliveTimeout = Math.max(2_000, Number(process.env.SERVER_KEEPALIVE_TIMEOUT_MS || 5_000));

server.listen(PORT, () => {
  console.log(`cookie-lab-api running on http://localhost:${PORT}`);
});
