const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");
const Stripe = require("stripe");
const braintree = require("braintree");

const PORT = Number(process.env.PORT) || 5050;
const SECRET = "cookie_lab_sim_secret_v1";
const MAX_FAILED_ATTEMPTS = 3;
const MAX_USES = 6;
const OWNER_USER = process.env.OWNER_USER || "owner";
const OWNER_PASS = process.env.OWNER_PASS || "owner123";
const OWNER_TOKEN_TTL_MS = 1000 * 60 * 60 * 2;
const ACCESS_KEY_MIN_TTL_MINUTES = 1;
const ACCESS_KEY_MAX_TTL_MINUTES = 60 * 24;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const BT_ENV = (process.env.BT_ENVIRONMENT || "sandbox").toLowerCase();
const BT_MERCHANT_ID = process.env.BT_MERCHANT_ID || "";
const BT_PUBLIC_KEY = process.env.BT_PUBLIC_KEY || "";
const BT_PRIVATE_KEY = process.env.BT_PRIVATE_KEY || "";
const btEnvironment = BT_ENV === "production" ? braintree.Environment.Production : braintree.Environment.Sandbox;
const btGateway = BT_MERCHANT_ID && BT_PUBLIC_KEY && BT_PRIVATE_KEY
  ? new braintree.BraintreeGateway({
    environment: btEnvironment,
    merchantId: BT_MERCHANT_ID,
    publicKey: BT_PUBLIC_KEY,
    privateKey: BT_PRIVATE_KEY
  })
  : null;

const sessions = new Map();
const wallets = new Map();

const STATUS_MESSAGES = {
  APPROVED: "Payment accepted",
  AUTHORIZED: "Payment authorized",
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
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Sim-Cookie,X-Owner-Token,X-Access-Key"
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
      networkThreshold: 90,
      declineThreshold: 76,
      allowPartialAvs: false,
      requireCvvMatch: true
    };
  }

  return {
    mode: "balanced",
    networkThreshold: 94,
    declineThreshold: 88,
    allowPartialAvs: true,
    requireCvvMatch: false
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

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 204, { ok: true });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
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

    if (req.method === "GET" && pathIs("/api/stripe/config", "/stripe/config")) {
      json(res, 200, {
        ok: true,
        enabled: Boolean(stripe),
        publishable_key: STRIPE_PUBLISHABLE_KEY || ""
      });
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

      if (!amountMinor) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_REQUEST", "Invalid amount") });
        return;
      }

      if (!/^[a-z]{3}$/.test(currency)) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_FORMAT", "Invalid currency format") });
        return;
      }

      const intent = await stripe.paymentIntents.create({
        amount: amountMinor,
        currency,
        payment_method_types: ["card"],
        receipt_email: email || undefined,
        description: "Cookie Lab Stripe Auth (test)",
        metadata: {
          source: "cookie-lab",
          gate: "stripe-auth"
        }
      });

      json(res, 200, {
        ok: true,
        ...statusPayload("PENDING", "payment_intent_created"),
        id: intent.id,
        client_secret: intent.client_secret,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status
      });
      return;
    }

    if (req.method === "GET" && pathIs("/api/braintree/config", "/braintree/config")) {
      json(res, 200, {
        ok: true,
        enabled: Boolean(btGateway),
        environment: BT_ENV
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

      const tokenResult = await btGateway.clientToken.generate({});
      json(res, 200, {
        ok: true,
        ...statusPayload("TOKEN_CREATED", "braintree_client_token_generated"),
        client_token: tokenResult.clientToken,
        environment: BT_ENV
      });
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
      if (!nonce) {
        json(res, 400, { ok: false, ...statusPayload("MISSING_FIELDS", "payment_method_nonce is required") });
        return;
      }
      if (!amount) {
        json(res, 400, { ok: false, ...statusPayload("INVALID_REQUEST", "Invalid amount") });
        return;
      }

      const sale = await btGateway.transaction.sale({
        amount,
        paymentMethodNonce: nonce,
        options: {
          submitForSettlement: false
        }
      });

      if (!sale.success) {
        const message = sale?.message || sale?.transaction?.processorResponseText || "Braintree auth failed";
        json(res, 402, { ok: false, ...statusPayload("PROCESSOR_ERROR", message) });
        return;
      }

      json(res, 200, {
        ok: true,
        authorized: true,
        ...statusPayload("AUTHORIZED", "braintree_authorized"),
        transaction_id: sale.transaction.id,
        status: sale.transaction.status,
        amount: sale.transaction.amount,
        type: sale.transaction.type
      });
      return;
    }

    json(res, 404, { ok: false, ...statusPayload("INVALID_REQUEST", "Not found") });
  } catch (error) {
    json(res, 500, {
      ok: false,
      ...statusPayload("SYSTEM_ERROR", error.message || "Internal error")
    });
  }
});

server.listen(PORT, () => {
  console.log(`cookie-lab-api running on http://localhost:${PORT}`);
});
