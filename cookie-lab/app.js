function rand(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const regions = {
  MX: { locale: "es_MX", currency: "MXN", region: "mx", country: "Mexico" },
  US: { locale: "en_US", currency: "USD", region: "us", country: "United States" },
  ES: { locale: "es_ES", currency: "EUR", region: "es", country: "Espana" },
  IT: { locale: "it_IT", currency: "EUR", region: "it", country: "Italia" },
  CA: { locale: "en_CA", currency: "CAD", region: "ca", country: "Canada" }
};

const LOCAL_API_BASES = ["http://localhost:5050", "http://127.0.0.1:5050"];
const DEFAULT_API_BASES = getRuntimeDefaultApiBases();
const BRIDGE_KEY = "eliteLabBridgeV1";
const VIEW_KEY = "eliteSignalLabView";
const FLOW_KEY = "eliteSignalFlowMode";
const DEFAULT_REGION = "US";
const COOKIE_GENERATE_COOLDOWN_MS = 10 * 60 * 1000;

const GATES = {
  amazon: {
    title: "Elite Stripe Auth Gate: flujo completo",
    description: "Sesion + cookies + wallet test con validacion de riesgo y soporte Stripe Auth sandbox.",
    capabilities: [
      "Owner login, key temporal y sesion API",
      "Analisis de cookie y formato de salida",
      "Stripe auth sandbox"
    ]
  },
  paypal: {
    title: "Elite PayPal Auth Gate: validacion de autorizacion",
    description: "Modo enfocado a autorizaciones y pruebas API usando Braintree Auth sandbox.",
    capabilities: [
      "Owner/login y conexion de API backups",
      "Validacion por politica de riesgo PayPal",
      "Braintree auth para autenticacion"
    ]
  },
  fwgates: {
    title: "Elite Braintree Auth Pro: escenarios avanzados",
    description: "Panel para pruebas de colas y escenarios internos con foco en Braintree Auth sandbox.",
    capabilities: [
      "Owner/login y sesion de pruebas",
      "Cookie flow + catalogo de estados seguros",
      "Braintree auth y ejecucion batch/loop"
    ]
  }
};

let lab = null;
let history = [];
let isGenerating = false;
let selectedGate = "amazon";
let flowMode = "amazon-cookies";
let lastCookieGenerationAt = 0;
const stats = {
  live: 0,
  dead: 0,
  error: 0,
  processed: 0,
  startedAt: Date.now()
};
let ownerSession = {
  owner_token: "",
  access_key: ""
};
let preferredApiBase = DEFAULT_API_BASES[0];
let stripeClient = null;
let stripeElements = null;
let stripeCard = null;
let btDropinInstance = null;
const queueState = {
  nextId: 1,
  items: []
};
const liveLogs = [];
const importer = {
  source: null,
  importedAddress: "",
  cards: [],
  cursor: 0
};
const checker = {
  running: false,
  stopRequested: false,
  current: 0,
  total: 0
};
const autoGenerator = {
  active: false,
  intervalId: null,
  nextRunTime: null
};
const MIN_DELAY = 40000;
const MAX_DELAY = 60000;
const MAX_VERIFIER_USES = 6;
const MAX_FAILED_ATTEMPTS = 3;

const RCODES = {
  success: [
    "APPROVED",
    "AUTHORIZED",
    "CAPTURED",
    "VERIFIED",
    "TOKEN_CREATED",
    "SUCCESS",
    "COMPLETED"
  ],
  issuerDecline: [
    "DECLINED",
    "DO_NOT_HONOR",
    "TRANSACTION_NOT_ALLOWED",
    "RESTRICTED_CARD",
    "CARD_BLOCKED",
    "CARD_DISABLED",
    "LIMIT_EXCEEDED",
    "DAILY_LIMIT_EXCEEDED",
    "MONTHLY_LIMIT_EXCEEDED"
  ],
  funds: [
    "INSUFFICIENT_FUNDS",
    "BALANCE_TOO_LOW",
    "CREDIT_LIMIT_REACHED",
    "AMOUNT_EXCEEDS_LIMIT",
    "CURRENCY_NOT_SUPPORTED"
  ],
  data: [
    "INVALID_CARD_NUMBER",
    "INVALID_EXPIRY",
    "INVALID_CVV",
    "INVALID_NAME",
    "INVALID_ADDRESS",
    "INVALID_POSTAL_CODE",
    "INVALID_COUNTRY",
    "MISSING_FIELDS",
    "INVALID_FORMAT",
    "INVALID_REQUEST"
  ],
  auth: [
    "3DS_REQUIRED",
    "3DS_FAILED",
    "3DS_PASSED",
    "OTP_REQUIRED",
    "OTP_FAILED",
    "OTP_EXPIRED",
    "AUTHENTICATION_REQUIRED",
    "AUTHENTICATION_FAILED"
  ],
  risk: [
    "FRAUD_SUSPECTED",
    "RISK_DECLINED",
    "VELOCITY_BLOCKED",
    "VELOCITY_LIMIT",
    "TOO_MANY_ATTEMPTS",
    "IP_BLOCKED",
    "DEVICE_BLOCKED",
    "DEVICE_MISMATCH",
    "AVS_MISMATCH",
    "CVV_MISMATCH",
    "SECURITY_CHECK_FAILED"
  ],
  technical: [
    "PROCESSOR_ERROR",
    "GATEWAY_ERROR",
    "NETWORK_ERROR",
    "CONNECTION_FAILED",
    "TIMEOUT",
    "SERVICE_UNAVAILABLE",
    "RATE_LIMITED",
    "SYSTEM_ERROR",
    "UNKNOWN_ERROR"
  ],
  internal: [
    "PENDING",
    "PROCESSING",
    "RETRY",
    "QUEUED",
    "WAITING_CONFIRMATION",
    "SOFT_DECLINE",
    "HARD_DECLINE",
    "UNKNOWN",
    "REVIEW_REQUIRED"
  ]
};

const SAFE_OUTPUTS = [
  "APPROVED",
  "DECLINED",
  "CARD_INVALID",
  "CARD_MISSING",
  "INVALID_CARD_NUMBER",
  "INVALID_EXPIRY",
  "INVALID_CVV",
  "INSUFFICIENT_FUNDS",
  "DO_NOT_HONOR",
  "TRANSACTION_NOT_ALLOWED",
  "3DS_REQUIRED",
  "3DS_FAILED",
  "AVS_MISMATCH",
  "CVV_MISMATCH",
  "TOO_MANY_ATTEMPTS",
  "FRAUD_SUSPECTED",
  "RISK_DECLINED",
  "TIMEOUT",
  "PROCESSOR_ERROR",
  "PENDING",
  "RETRY",
  "REVIEW_REQUIRED"
];

const OK_SET = new Set(RCODES.success);
const SUCCESS_STATUS_SET = OK_SET;
const ALL_SET = new Set(
  Object.values(RCODES)
    .flat()
    .concat(SAFE_OUTPUTS)
);

const MSGS = {
  APPROVED: "Payment accepted",
  DECLINED: "Transaction rejected",
  CARD_INVALID: "Card invalid",
  CARD_MISSING: "Card missing",
  INSUFFICIENT_FUNDS: "Balance too low",
  INVALID_CARD_NUMBER: "Card format invalid",
  "3DS_REQUIRED": "Authentication needed",
  AVS_MISMATCH: "Address verification failed",
  TIMEOUT: "Gateway did not respond",
  PROCESSOR_ERROR: "Payment processor error",
  PENDING: "Transaction processing"
};

function getMsg(status) {
  const key = String(status || "UNKNOWN").toUpperCase();
  if (MSGS[key]) return MSGS[key];
  return key.replaceAll("_", " ");
}

function toggleBtns(disabled) {
  const buttons = document.querySelectorAll(".actions button");
  buttons.forEach((btn) => {
    btn.disabled = disabled;
    btn.style.opacity = disabled ? "0.65" : "1";
    btn.style.cursor = disabled ? "not-allowed" : "pointer";
  });
}

function luhnCheckDigit(baseNumber) {
  let sum = 0;
  const reversed = String(baseNumber).split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    let digit = Number(reversed[i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

function detectBrandByPrefix(prefixDigits) {
  const digits = String(prefixDigits || "");
  if (/^3[47]/.test(digits) || /^3/.test(digits)) return "amex";
  if (/^(6011|65|64[4-9]|622)/.test(digits) || /^6/.test(digits)) return "discover";
  if (/^(5[1-5]|2(2[2-9]|[3-6][0-9]|7[01]|720))/.test(digits)) return "mastercard";
  if (/^4/.test(digits)) return "visa";
  return "unknown";
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildGeneratedCardsFromConfig(config) {
  const rawBinInput = String(config.binInput || "").trim();
  const binPattern = rawBinInput.toLowerCase().replace(/[^0-9x]/g, "");
  const numericBin = rawBinInput.replace(/\D/g, "");
  const hasWildcardPattern = /x/i.test(rawBinInput);
  const bin = hasWildcardPattern ? binPattern : numericBin;
  const month = String(config.month || "01").toLowerCase();
  const year = String(config.year || "2030").toLowerCase();
  const autoMonth = month === "rnd" || Boolean(config.autoMonth);
  const autoYear = year === "rnd" || Boolean(config.autoYear);
  const countRaw = Number.parseInt(String(config.count || "10"), 10);
  const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(50, countRaw)) : 10;
  const brandSeed = String(bin || "").replace(/x/g, "0");
  const brand = detectBrandByPrefix(brandSeed);
  const targetLength = brand === "amex" ? 15 : 16;
  const baseLength = targetLength - 1;

  const generated = [];
  while (generated.length < count) {
    let base = "";
    if (bin && bin.length >= 1) {
      const template = bin.slice(0, baseLength);
      for (let i = 0; i < baseLength; i++) {
        const ch = template[i];
        if (/^\d$/.test(ch || "")) {
          base += ch;
        } else if (ch === "x") {
          base += String(randomInt(0, 9));
        } else {
          base += String(randomInt(0, 9));
        }
      }
    } else {
      for (let i = 0; i < baseLength; i++) base += String(randomInt(0, 9));
    }

    const check = luhnCheckDigit(base);
    const card = `${base}${check}`;
    if (!luhnCheck(card)) continue;

    const generatedMonth = autoMonth ? String(randomInt(1, 12)).padStart(2, "0") : month;
    const currentYear = new Date().getFullYear();
    const generatedYear = autoYear ? String(randomInt(currentYear, currentYear + 8)) : year;

    const cvvLength = brand === "amex" ? 4 : 3;
    const cvvMin = Math.pow(10, cvvLength - 1);
    const cvvMax = Math.pow(10, cvvLength) - 1;
    const cvv = String(randomInt(cvvMin, cvvMax));
    generated.push(`${card}|${generatedMonth}|${generatedYear}|${cvv}`);
  }

  return generated;
}

function generateDemoCardsLite() {
  const generated = buildGeneratedCardsFromConfig({
    binInput: document.getElementById("demoCardBinLite")?.value,
    month: document.getElementById("demoCardMonthLite")?.value,
    year: document.getElementById("demoCardYearLite")?.value,
    count: document.getElementById("demoCardCountLite")?.value
  });

  const cardsEl = document.getElementById("cardsInput");
  if (cardsEl) cardsEl.value = generated.join("\n");

  log("GEN", `Generadas ${generated.length} tarjetas demo (Gate).`);
  setStatus(`Tarjetas generadas: ${generated.length}.`, "done");
}

function generateDemoCardsAmazon() {
  const generated = buildGeneratedCardsFromConfig({
    binInput: document.getElementById("demoCardBinAmazon")?.value,
    month: document.getElementById("demoCardMonthAmazon")?.value,
    year: document.getElementById("demoCardYearAmazon")?.value,
    count: document.getElementById("demoCardCountAmazon")?.value
  });

  const amazonCardsEl = document.getElementById("cardsInputAmazon");
  if (amazonCardsEl) amazonCardsEl.value = generated.join("\n");

  log("GEN", `Generadas ${generated.length} tarjetas demo (Amazon).`);
  setStatus(`Tarjetas generadas: ${generated.length}.`, "done");
}

function clearDemoCardsAmazon() {
  const amazonCardsEl = document.getElementById("cardsInputAmazon");
  if (amazonCardsEl) amazonCardsEl.value = "";
}

function clearDemoCardsLite() {
  const cardsEl = document.getElementById("cardsInput");
  if (cardsEl) cardsEl.value = "";
  const amazonCardsEl = document.getElementById("cardsInputAmazon");
  if (amazonCardsEl) amazonCardsEl.value = "";
}

function toggleCtrl(running) {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  if (startBtn) startBtn.disabled = running;
  if (stopBtn) stopBtn.disabled = !running;
}

function nowStamp() {
  return new Date().toLocaleTimeString();
}

function readBridgeData() {
  try {
    return JSON.parse(localStorage.getItem(BRIDGE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function parsePipeCard(raw) {
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split("|").map((part) => part.trim());
  if (parts.length < 4) return null;

  const [cardNumber, expMonth, rawExpYear, cvv] = parts;
  let expYear = rawExpYear;
  if (!/^\d{13,19}$/.test(cardNumber)) return null;
  if (!/^\d{2}$/.test(expMonth)) return null;
  if (/^\d{2}$/.test(rawExpYear)) {
    expYear = `20${rawExpYear}`;
  } else if (!/^\d{4}$/.test(rawExpYear)) {
    return null;
  }
  if (isCardExpired(expMonth, expYear)) return null;
  if (!/^\d{3,4}$/.test(cvv)) return null;

  return { cardNumber, expMonth, expYear, cvv, raw };
}

function parseStrictCardLine(raw, lineNumber) {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, empty: true };

  const parts = text.split("|").map((s) => s.trim());
  if (parts.length !== 4) {
    return { ok: false, error: `Linea ${lineNumber}: formato invalido. Usa CC|MM|YYYY|CVV o CC|MM|YY|CVV` };
  }

  const [cardNumber, expMonth, rawExpYear, cvv] = parts;
  if (!/^\d{13,19}$/.test(cardNumber)) {
    return { ok: false, error: `Linea ${lineNumber}: numero de tarjeta invalido.` };
  }
  if (!luhnCheck(cardNumber)) {
    return { ok: false, error: `Linea ${lineNumber}: tarjeta no pasa Luhn.` };
  }
  if (!/^(0[1-9]|1[0-2])$/.test(expMonth)) {
    return { ok: false, error: `Linea ${lineNumber}: mes invalido (01-12).` };
  }
  
  // Aceptar formato YY (2 digitos) o YYYY (4 digitos)
  let expYear = rawExpYear;
  if (/^\d{2}$/.test(rawExpYear)) {
    // Convertir YY a YYYY (asume 20YY)
    expYear = "20" + rawExpYear;
  } else if (!/^\d{4}$/.test(rawExpYear)) {
    return { ok: false, error: `Linea ${lineNumber}: anio invalido (YY o YYYY).` };
  }
  
  if (!/^\d{3,4}$/.test(cvv)) {
    return { ok: false, error: `Linea ${lineNumber}: CVV invalido.` };
  }
  if (isCardExpired(expMonth, expYear)) {
    return { ok: false, error: `Linea ${lineNumber}: tarjeta expirada.` };
  }

  return {
    ok: true,
    card: { cardNumber, expMonth, expYear, cvv, raw: text }
  };
}

function getCardsFromInput() {
  const inputEl = document.getElementById("cardsInput");
  const amazonInputEl = document.getElementById("cardsInputAmazon");
  const primaryText = String(inputEl?.value || "").trim();
  const amazonText = String(amazonInputEl?.value || "").trim();
  const rawText = primaryText || amazonText;
  if (!rawText) return { ok: true, cards: [], source: "none" };

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const cards = [];
  const discarded = [];
  for (let i = 0; i < lines.length; i++) {
    const result = parseStrictCardLine(lines[i], i + 1);
    if (!result.ok) {
      discarded.push({ line: i + 1, raw: lines[i], reason: result.error || "Formato invalido." });
      continue;
    }
    cards.push(result.card);
  }

  if (!cards.length) {
    return {
      ok: false,
      cards: [],
      source: "input",
      discarded,
      message: "No hay tarjetas validas (Luhn/no expirada). Todas fueron descartadas."
    };
  }

  return { ok: true, cards, source: primaryText ? "input" : "amazon_input", discarded };
}

function ensureCardsReady() {
  const fromInput = getCardsFromInput();
  if (!fromInput.ok) return fromInput;

  if (fromInput.cards.length > 0) {
    importer.cards = fromInput.cards;
    importer.cursor = 0;
    return {
      ok: true,
      count: importer.cards.length,
      cards: importer.cards,
      source: "input",
      discarded: fromInput.discarded || []
    };
  }

  if (importer.cards.length > 0) {
    return { 
      ok: true, 
      count: importer.cards.length, 
      cards: importer.cards,
      source: "bridge" 
    };
  }

  return {
    ok: false,
    count: 0,
    cards: [],
    source: "none",
    message: "Agrega tarjetas primero en formato CC|MM|YYYY|CVV o CC|MM|YY|CVV (ej: 5833702060829863|01|2026|619 o 5833702060829863|01|26|619)."
  };
}

function reflectCardInputIssue(reason, detailMessage) {
  const status = reason === "missing_card_input" ? "CARD_MISSING" : "CARD_INVALID";
  const assocPayload = {
    test_id: `assoc_${Date.now()}`,
    method: "input_precheck",
    no_charge: true,
    association: {
      status,
      status_message: detailMessage || (status === "CARD_MISSING" ? "CARD_MISSING" : "CARD_INVALID"),
      reason: reason || "invalid_or_missing_card"
    },
    card: {
      luhn_valid: false,
      imported: true
    },
    created_at: new Date().toISOString()
  };

  const assocEl = document.getElementById("walletAssocResult");
  if (assocEl) {
    assocEl.textContent = [
      "Resultado de asociacion",
      `Estado: ${assocPayload.association.status}`,
      `Mensaje: ${assocPayload.association.status_message}`,
      `Motivo: ${assocPayload.association.reason}`,
      "Cobro: No"
    ].join("\n");
  }
}

function mapRegion(region) {
  const normalized = String(region || "").toUpperCase();
  return regions[normalized] ? normalized : null;
}

function updateChip(bridge) {
  const chip = document.getElementById("bridgeChip");
  if (!chip) return;
  const hasImported = Boolean(importer.cards.length || importer.importedAddress);
  chip.textContent = hasImported ? "BRIDGE: IMPORTED" : "BRIDGE: --";
  chip.className = hasImported ? "chip imported" : "chip";
}

function nextCard() {
  if (!importer.cards.length) return null;
  const index = importer.cursor % importer.cards.length;
  importer.cursor += 1;
  return importer.cards[index];
}

function loadImports() {
  const bridge = readBridgeData();
  importer.source = bridge;
  importer.cursor = 0;
  importer.cards = Array.isArray(bridge?.cards)
    ? bridge.cards.map(parsePipeCard).filter(Boolean)
    : [];
  importer.importedAddress = String(bridge?.address || "").trim();

  const regionSelect = document.getElementById("region");
  const walletAlias = document.getElementById("walletAlias");

  if (regionSelect) {
    regionSelect.value = DEFAULT_REGION;
  }

  if (walletAlias && importer.cards.length) {
    const last4 = importer.cards[0].cardNumber.slice(-4);
    walletAlias.value = `Imported Wallet ${last4}`;
  }

  updateChip(bridge);

  if (importer.cards.length || importer.importedAddress) {
    log(
      "BRIDGE",
      `Importado desde landing (${importer.cards.length} card(s), address=${importer.importedAddress ? "yes" : "no"})`
    );
  }
}

function log(type, message) {
  liveLogs.unshift(`[${nowStamp()}] [${type}] ${message}`);
  if (liveLogs.length > 120) liveLogs.length = 120;
  const el = document.getElementById("liveLogs");
  if (el) el.textContent = liveLogs.join("\n");
}

function clearLogs() {
  liveLogs.length = 0;
  const el = document.getElementById("liveLogs");
  if (el) el.textContent = "";
}

function loadPastedCookie() {
  const sampleEl = document.getElementById("sampleCookie");
  const cookieText = (sampleEl?.value || "").trim();
  
  if (!cookieText) {
    setStatus("No hay cookie pegada para cargar. Pega una cookie primero.", "running");
    log("COOKIE", "Error: No hay cookie en el campo de entrada");
    return false;
  }
  
  // Parsear la cookie pegada
  const parsed = parseCookiePairs(cookieText);
  if (!parsed || Object.keys(parsed).length === 0) {
    setStatus("Cookie inválida. Verifica el formato (key=value; key=value)", "running");
    log("COOKIE", "Error: Formato de cookie inválido");
    return false;
  }
  
  // Validar que sea formato Amazon
  const validation = validateFormattedCookie(cookieText, "amazon_like");
  if (!validation.ok) {
    setStatus(`Cookie inválida: ${validation.reason}`, "running");
    log("COOKIE", `Error de validación: ${validation.reason}`);
    return false;
  }
  
  // Crear objeto lab con la cookie pegada
  const region = document.getElementById("region").value;
  const profile = regions[region];
  
  lab = {
    profile,
    wallet: { wallet_id: "external_wallet", wallet_state: "external" },
    source: { source_id: "external_source", source_state: "external" },
    cookies: parsed,
    approval: { auto_approval: false },
    api_mode: { enabled: false, external_cookie_mode: true },
    test_mode: { charge_enabled: false, method: "external_cookie" },
    test_policy: "Cookie externa proporcionada por usuario. Validación de tarjetas habilitada.",
    lab_state: "session_active_external",
    gate: selectedGate,
    cookie_source: "external"
  };
  
  updateUI();
  pushHistory("EXTERNAL_COOKIE_LOADED", parsed);
  setStatus("Cookie externa cargada correctamente. Lista para validar tarjetas.", "done");
  log("COOKIE", `Cookie externa cargada: ${Object.keys(parsed).length} claves detectadas`);
  return true;
}

function showQueue() {
  const el = document.getElementById("queueStatus");
  if (!el) return;
  const view = queueState.items.slice(0, 30).map((job) => ({
    id: job.id,
    phase: job.phase,
    status: job.status,
    detail: job.detail,
    updated_at: job.updatedAt
  }));
  el.textContent = view.length ? JSON.stringify(view, null, 2) : "Queue vacia.";
}

function addJob(phase, detail = "") {
  const job = {
    id: queueState.nextId++,
    phase,
    status: "pending",
    detail,
    updatedAt: nowStamp()
  };
  queueState.items.unshift(job);
  if (queueState.items.length > 200) queueState.items.length = 200;
  showQueue();
  return job.id;
}

function updJob(jobId, status, detail = "") {
  const job = queueState.items.find((item) => item.id === jobId);
  if (!job) return;
  job.status = status;
  job.detail = detail || job.detail;
  job.updatedAt = nowStamp();
  showQueue();
}

function setPreset() {
  const mode = document.getElementById("gatePreset")?.value || "auto";
  const batchEl = document.getElementById("batchSize");
  const delayEl = document.getElementById("loopDelayMs");
  if (!batchEl || !delayEl) return;

  let preset;
  if (mode === "safe") {
    preset = { batch: 8, delay: 900 };
  } else if (mode === "turbo") {
    preset = { batch: 25, delay: 100 };
  } else {
    const autoByGate = {
      amazon: { batch: 12, delay: 450 },
      paypal: { batch: 10, delay: 700 },
      fwgates: { batch: 20, delay: 300 }
    };
    preset = autoByGate[selectedGate] || { batch: 10, delay: 500 };
  }

  batchEl.value = String(preset.batch);
  delayEl.value = String(preset.delay);
  log("PRESET", `Aplicado preset ${mode.toUpperCase()} -> batch=${preset.batch}, delay=${preset.delay}ms`);
  setStatus(`Preset ${mode.toUpperCase()} aplicado.`, "done");
}

function setStatus(text, kind = "") {
  const statusEl = document.getElementById("processStatus");
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = `process-status ${kind}`.trim();
}

function setCookieGenerateStatus(mode = "hidden", text = "") {
  const box = document.getElementById("cookieGenerateStatus");
  const textEl = document.getElementById("cookieGenerateStatusText");
  if (!box || !textEl) return;

  box.classList.remove("is-visible", "is-generating", "is-done");

  if (mode === "hidden") return;

  box.classList.add("is-visible");
  if (mode === "generating") {
    box.classList.add("is-generating");
    textEl.textContent = text || "Generando cookie...";
    return;
  }

  if (mode === "done") {
    box.classList.add("is-done");
    textEl.textContent = text || "Cookie generada.";
    return;
  }

  textEl.textContent = text || "Error al generar cookie.";
}

function updApi(base, isError = false) {
  const chip = document.getElementById("apiChip");
  if (!chip) return;

  if (!base) {
    chip.textContent = isError ? "API: OFFLINE" : "API: --";
    chip.className = isError ? "chip warn" : "chip";
    return;
  }

  let host = base;
  try {
    host = new URL(base).host;
  } catch (error) {
    // Keep raw base if URL parsing fails.
  }

  chip.textContent = `API: ${host}`;
  chip.className = "chip good";
}

function updGate() {
  const gateIds = ["amazon", "paypal", "fwgates"];
  const modeChip = document.getElementById("modeChip");
  const quickSelect = document.getElementById("gatewayQuickSelect");
  const statusMap = {
    amazon: document.getElementById("gateStatusAmazon"),
    paypal: document.getElementById("gateStatusPaypal"),
    fwgates: document.getElementById("gateStatusFwgates")
  };

  gateIds.forEach((gate) => {
    const el = document.getElementById(`gate-${gate}`);
    if (el) {
      el.classList.toggle("active", gate === selectedGate);
    }
    if (statusMap[gate]) {
      statusMap[gate].textContent = gate === selectedGate ? "Active" : "Standby";
    }
  });

  if (modeChip) {
    const modeLabel =
      selectedGate === "amazon"
        ? "Stripe Auth"
        : "Braintree Auth";
    modeChip.textContent = `MODE: ${modeLabel}`;
    modeChip.className = selectedGate === "amazon" ? "chip good" : "chip warn";
  }

  const authHint = document.getElementById("selectedAuthHint");
  if (authHint) {
    authHint.textContent = selectedGate === "amazon" ? "Auth activo: Stripe Auth" : "Auth activo: Braintree Auth";
  }

  if (quickSelect && gateIds.includes(selectedGate)) {
    quickSelect.value = selectedGate;
  }

  applyGateCaps();
}

function initQuick() {
  const quickSelect = document.getElementById("gatewayQuickSelect");
  if (!quickSelect) return;

  if (["amazon", "paypal", "fwgates"].includes(selectedGate)) {
    quickSelect.value = selectedGate;
  }

  quickSelect.addEventListener("change", () => {
    const nextGate = quickSelect.value;
    if (["amazon", "paypal", "fwgates"].includes(nextGate)) {
      selectGate(nextGate);
    }
  });
}

function showTab(target) {
  const tabs = [
    { btn: document.getElementById("resultTabLive"), pane: document.getElementById("resultPaneLive"), key: "live" },
    { btn: document.getElementById("resultTabDead"), pane: document.getElementById("resultPaneDead"), key: "dead" },
    { btn: document.getElementById("resultTabErr"), pane: document.getElementById("resultPaneError"), key: "error" }
  ];

  tabs.forEach((tab) => {
    const active = tab.key === target;
    if (tab.btn) tab.btn.classList.toggle("active", active);
    if (tab.pane) tab.pane.classList.toggle("active", active);
  });
}

function initTabs() {
  const allTabs = document.querySelectorAll(".result-tab[data-target]");
  if (!allTabs.length) return;

  allTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-target");
      if (target) showTab(target);
    });
  });

  // Default tab mimics common checker view: rejected/dead visible first.
  showTab("dead");
}

function updTabCounts() {
  const liveCountEl = document.getElementById("resultTabLiveCount");
  const deadCountEl = document.getElementById("resultTabDeadCount");
  const errCountEl = document.getElementById("resultTabErrCount");

  if (liveCountEl) liveCountEl.textContent = String(stats.live);
  if (deadCountEl) deadCountEl.textContent = String(stats.dead);
  if (errCountEl) errCountEl.textContent = String(stats.error);
}

function applyGateCaps() {
  const gateInfo = GATES[selectedGate] || GATES.amazon;
  const overviewTitle = document.getElementById("gateOverviewTitle");
  const overviewDesc = document.getElementById("gateOverviewDesc");
  const capabilitiesList = document.getElementById("gateCapabilitiesList");

  if (overviewTitle) overviewTitle.textContent = gateInfo.title;
  if (overviewDesc) overviewDesc.textContent = gateInfo.description;
  if (capabilitiesList) {
    capabilitiesList.innerHTML = gateInfo.capabilities
      .map((capability) => `<div class="cap">${capability}</div>`)
      .join("");
  }

  const sections = document.querySelectorAll(".gate-section[data-gates]");
  sections.forEach((section) => {
    const gates = String(section.getAttribute("data-gates") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const visible = gates.includes(selectedGate);
    section.classList.toggle("is-hidden", !visible);

    const controls = section.querySelectorAll("input, select, textarea, button");
    controls.forEach((control) => {
      control.disabled = !visible;
    });
  });
}

function loadApiBackupsFromStorage() {
  try {
    const raw = localStorage.getItem("cookieLab.apiBackups") || "";
    if (!raw) return;
    const values = raw
      .split(",")
      .map((item) => normalizeApiBase(item))
      .filter(Boolean);

    if (values.length) {
      window.API_BACKUP_BASES = values;
      const input = document.getElementById("apiBackups");
      if (input) input.value = values.join(", ");
    }
  } catch (error) {
    // Ignore storage errors and keep defaults.
  }
}

function saveApiBackups() {
  const input = document.getElementById("apiBackups");
  if (!input) return;

  const values = String(input.value || "")
    .split(",")
    .map((item) => normalizeApiBase(item))
    .filter(Boolean);

  window.API_BACKUP_BASES = values;
  localStorage.setItem("cookieLab.apiBackups", values.join(","));
  setStatus(`APIs guardadas (${values.length} backup(s)).`, "done");
}

async function testApiBackups() {
  const status = await apiRequest("/api/health", { method: "GET" });
  if (status.ok) {
    setStatus(`API activa: ${status.base}`, "done");
  } else {
    setStatus("Ninguna API de respaldo disponible.", "running");
  }
}

function selectGate(gate) {
  selectedGate = gate;
  updGate();
  setPreset();
  log("GATE", `Seleccionado ${gate.toUpperCase()}`);
  setStatus(`Gate seleccionado: ${gate.toUpperCase()}`, "running");
}

function updateVerifierStatusPanel() {
  const verifierEl = document.getElementById("verifierStatus");
  if (!verifierEl) return;

  if (!lab) {
    verifierEl.textContent = "Sin sesion activa.";
    return;
  }

  verifierEl.textContent = [
    `Gate: ${selectedGate}`,
    `Modo API: ${lab.api_mode || "local"}`,
    `Cookie: ${lab.cookies?.cookie_state || "active"}`,
    `Ultimo estado: ${lab.wallet_association_test?.association?.status || lab.wallet_association_test?.status || "N/A"}`,
    `Ultimo mensaje: ${lab.wallet_association_test?.association?.status_message || "N/A"}`
  ].join("\n");
}

function setProgress(currentSec, totalSec) {
  const fillEl = document.getElementById("progressFill");
  const counterEl = document.getElementById("progressCounter");
  const safeTotal = Math.max(1, Number(totalSec) || 1);
  const safeCurrent = Math.min(safeTotal, Math.max(0, Number(currentSec) || 0));
  const pct = Math.min(100, Math.round((safeCurrent / safeTotal) * 100));

  if (fillEl) fillEl.style.width = `${pct}%`;
  if (counterEl) counterEl.textContent = `${safeCurrent} / ${safeTotal}`;
}

function updateStatsUI() {
  const liveEl = document.getElementById("liveStat");
  const deadEl = document.getElementById("deadStat");
  const errorEl = document.getElementById("errorStat");
  const speedEl = document.getElementById("speedStat");

  const elapsedMs = Math.max(1, Date.now() - stats.startedAt);
  const speed = ((stats.processed * 60000) / elapsedMs).toFixed(1);

  if (liveEl) liveEl.textContent = String(stats.live);
  if (deadEl) deadEl.textContent = String(stats.dead);
  if (errorEl) errorEl.textContent = String(stats.error);
  if (speedEl) speedEl.textContent = String(speed);
  updTabCounts();
}

function registerAssociationResult(status, cookieState) {
  stats.processed += 1;

  if (SUCCESS_STATUS_SET.has(status)) {
    stats.live += 1;
  } else if (cookieState === "dead" || cookieState === "blocked") {
    stats.dead += 1;
  } else {
    stats.error += 1;
  }

  updateStatsUI();
}

function resolveSuccessStatus(gate, viaApi = false) {
  if (gate === "amazon") return "APPROVED";
  if (gate === "paypal") return viaApi ? "AUTHORIZED" : "VERIFIED";
  if (gate === "fwgates") return "VERIFIED";
  return "SUCCESS";
}

function mapReasonToSafeStatus(reason, context = {}) {
  const r = String(reason || "").toLowerCase();

  if (r.includes("missing_card")) return "CARD_MISSING";
  if (r.includes("invalid_card") || r.includes("luhn")) return "CARD_INVALID";
  if (r.includes("invalid_exp")) return "INVALID_EXPIRY";
  if (r.includes("invalid_cvv")) return "INVALID_CVV";
  if (r.includes("missing")) return "MISSING_FIELDS";
  if (r.includes("format")) return "INVALID_FORMAT";
  if (r.includes("currency")) return "CURRENCY_NOT_SUPPORTED";
  if (r.includes("insufficient") || r.includes("fund")) return "INSUFFICIENT_FUNDS";
  if (r.includes("do_not_honor")) return "DO_NOT_HONOR";
  if (r.includes("restricted")) return "RESTRICTED_CARD";
  if (r.includes("transaction_not_allowed")) return "TRANSACTION_NOT_ALLOWED";
  if (r.includes("cookie_blocked") || context?.verifier?.blocked) return "TOO_MANY_ATTEMPTS";
  if (r.includes("cookie_dead") || context?.verifier?.dead) return "VELOCITY_LIMIT";
  if (r.includes("cookie_stale")) return "SOFT_DECLINE";
  if (r.includes("avs")) return "AVS_MISMATCH";
  if (r.includes("cvv")) return "CVV_MISMATCH";
  if (r.includes("device") && (r.includes("block") || r.includes("mismatch"))) return "DEVICE_BLOCKED";
  if (r.includes("ip") && r.includes("block")) return "IP_BLOCKED";
  if (r.includes("security") || r.includes("check_failed")) return "SECURITY_CHECK_FAILED";
  if (r.includes("fraud")) return "FRAUD_SUSPECTED";
  if (r.includes("risk") || r.includes("velocity") || r.includes("too_many_attempts")) return "RISK_DECLINED";
  if (r.includes("3ds_required")) return "3DS_REQUIRED";
  if (r.includes("3ds_failed")) return "3DS_FAILED";
  if (r.includes("otp_required")) return "OTP_REQUIRED";
  if (r.includes("otp_failed")) return "OTP_FAILED";
  if (r.includes("otp_expired")) return "OTP_EXPIRED";
  if (r.includes("authentication_required")) return "AUTHENTICATION_REQUIRED";
  if (r.includes("authentication_failed")) return "AUTHENTICATION_FAILED";
  if (r.includes("network")) return "NETWORK_ERROR";
  if (r.includes("connection") || r.includes("connect") || r.includes("api no disponible")) return "CONNECTION_FAILED";
  if (r.includes("timeout")) return "TIMEOUT";
  if (r.includes("gateway")) return "GATEWAY_ERROR";
  if (r.includes("service_unavailable") || r.includes("unavailable")) return "SERVICE_UNAVAILABLE";
  if (r.includes("processor")) return "PROCESSOR_ERROR";
  if (r.includes("rate")) return "RATE_LIMITED";
  if (r.includes("system") || r.includes("internal")) return "SYSTEM_ERROR";

  return "UNKNOWN_ERROR";
}

function normalizeSafeStatus(rawStatus, reason, context = {}) {
  const upper = String(rawStatus || "").toUpperCase();
  if (ALL_SET.has(upper)) return upper;

  if (upper === "PENDING" || upper === "PROCESSING" || upper === "QUEUED") {
    return upper;
  }

  if (upper === "AUTHORIZED" || upper === "APPROVED" || upper === "SUCCESS") {
    return resolveSuccessStatus(context.gate, Boolean(context.apiEnabled));
  }

  if (upper === "REJECTED" || upper === "DENIED" || upper === "HARD_DECLINE") {
    return mapReasonToSafeStatus(reason, context);
  }

  if (upper === "RETRY" || upper === "WAITING_CONFIRMATION") {
    return upper;
  }

  return mapReasonToSafeStatus(reason, context) || "UNKNOWN";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCooldownRemaining(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSec = Math.ceil(safeMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getRuntimeDefaultApiBases() {
  const bases = [];
  const origin = window.location?.origin;
  const runtimeBases = readRuntimeApiBases();

  bases.push(...runtimeBases);
  if (origin && /^https?:\/\//i.test(origin) && origin !== "null") {
    bases.push(origin);
  }

  // Solo usa localhost como fallback cuando la app corre en localhost/127.0.0.1
  const host = String(window.location?.hostname || "").toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  if (isLocalHost) {
    bases.push(...LOCAL_API_BASES);
  }

  return [...new Set(bases.map(normalizeApiBase).filter(Boolean))];
}

function readRuntimeApiBases() {
  const output = [];

  const meta = document.querySelector('meta[name="elite-api-base"]');
  const metaValue = String(meta?.getAttribute("content") || "").trim();
  if (metaValue) {
    output.push(
      ...metaValue
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  const globalValue = window.ELITE_API_BASES;
  if (Array.isArray(globalValue)) {
    output.push(...globalValue.map((item) => String(item || "").trim()).filter(Boolean));
  } else if (typeof globalValue === "string" && globalValue.trim()) {
    output.push(...globalValue.split(",").map((item) => item.trim()).filter(Boolean));
  }

  return [...new Set(output.map(normalizeApiBase).filter(Boolean))];
}

function isApiBaseProtocolCompatible(base) {
  if (!base) return false;
  const pageProtocol = window.location?.protocol || "";

  try {
    const parsed = new URL(base);
    // Evita mixed-content: una pagina HTTPS no debe llamar APIs HTTP.
    if (pageProtocol === "https:" && parsed.protocol !== "https:") {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function normalizeApiBase(base) {
  return String(base || "").trim().replace(/\/+$/, "");
}

function getApiBases() {
  const configured = Array.isArray(window.API_BACKUP_BASES) ? window.API_BACKUP_BASES : [];
  const merged = [preferredApiBase, ...configured, ...DEFAULT_API_BASES]
    .map(normalizeApiBase)
    .filter(Boolean)
    .filter(isApiBaseProtocolCompatible);

  return [...new Set(merged)];
}

async function runSlowGenerationTimer(totalMs) {
  const started = Date.now();
  const totalSec = Math.max(1, Math.ceil(totalMs / 1000));
  setProgress(0, totalSec);

  while (Date.now() - started < totalMs) {
    if (checker.stopRequested) {
      throw new Error("generation_cancelled");
    }
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const remaining = Math.max(0, Math.ceil((totalMs - (Date.now() - started)) / 1000));
    setStatus(`Procesando generacion... ${elapsed}s (faltan ~${remaining}s)`, "running");
    setProgress(elapsed, totalSec);
    await sleep(1000);
  }

  setProgress(totalSec, totalSec);
}

function createWallet(alias) {
  return {
    wallet_id: "wallet_" + rand(8),
    wallet_alias: alias,
    wallet_state: "wallet_created"
  };
}

function createSource() {
  return {
    source_id: "source_" + rand(10),
    source_type: "credential",
    source_state: "source_created"
  };
}

function generateCookies(profile, wallet, source) {
  return {
    locale: profile.locale,
    pref_currency: profile.currency,
    region: profile.region,
    country: profile.country,
    wallet_id: wallet.wallet_id,
    wallet_state: wallet.wallet_state,
    source_id: source.source_id,
    source_state: source.source_state,
    session_id: "session_" + rand(12),
    auth_token: "auth_" + rand(20),
    last_seen: Date.now(),
    metrics: "metrics_" + rand(6)
  };
}

function randomDigits(len) {
  return randFrom("0123456789", len);
}

function isCardExpired(expMonth, expYear) {
  const month = Number(expMonth);
  const year = Number(expYear);
  if (!Number.isInteger(month) || !Number.isInteger(year)) return true;
  if (month < 1 || month > 12) return true;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear) return true;
  if (year === currentYear && month < currentMonth) return true;
  return false;
}

function luhnCheck(cardNumber) {
  const digits = String(cardNumber).replace(/\D/g, "");
  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function generateLuhnCardNumber() {
  // 15 random digits + 1 check digit (Luhn)
  const base = randomDigits(15);
  for (let check = 0; check <= 9; check++) {
    const candidate = `${base}${check}`;
    if (luhnCheck(candidate)) return candidate;
  }
  return `${base}0`;
}

async function apiRequest(path, options = {}) {
  const bases = getApiBases();
  let lastTransportError = null;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        data = {
          ok: false,
          reason: "Invalid JSON response"
        };
      }

      if (response.status >= 500) {
        lastTransportError = new Error(`Server error ${response.status} at ${base}`);
        continue;
      }

      preferredApiBase = base;
      updApi(base, false);
      return { ok: response.ok, status: response.status, data, base };
    } catch (error) {
      lastTransportError = error;
    }
  }

  updApi(null, true);

  return {
    ok: false,
    status: 0,
    data: {
      ok: false,
      reason: `No backup API available (${lastTransportError?.message || "unknown network error"})`
    },
    base: null
  };
}

async function createApiSimulationSession(region) {
  const riskMode = (document.getElementById("riskModeSelect")?.value || "balanced")
    .trim()
    .toLowerCase();
  const providerByGate = {
    amazon: "stripe",
    paypal: "paypal",
    fwgates: "braintree"
  };
  return apiRequest("/api/session/create", {
    method: "POST",
    headers: ownerSession.access_key ? { "X-Access-Key": ownerSession.access_key } : {},
    body: {
      region,
      risk_mode: riskMode === "strict" ? "strict" : "balanced",
      gate: selectedGate,
      provider: providerByGate[selectedGate] || "stripe"
    }
  });
}

async function ownerLoginApi(username, password) {
  return apiRequest("/api/owner/login", {
    method: "POST",
    body: { username, password }
  });
}

async function ownerGenerateKeyApi(profileId, ttlMinutes) {
  return apiRequest("/api/owner/generate-key", {
    method: "POST",
    headers: ownerSession.owner_token ? { "X-Owner-Token": ownerSession.owner_token } : {},
    body: {
      profile_id: profileId,
      ttl_minutes: ttlMinutes
    }
  });
}

async function openApiWallet(cookie, alias) {
  return apiRequest("/api/wallet/open", {
    method: "POST",
    headers: { "X-Sim-Cookie": cookie },
    body: { alias }
  });
}

async function associateApiCard(cookie, walletId, cardNumber) {
  return apiRequest("/api/wallet/associate-card", {
    method: "POST",
    headers: { "X-Sim-Cookie": cookie },
    body: {
      wallet_id: walletId,
      card_number: cardNumber
    }
  });
}

async function loadStripeConfigFromApi() {
  const statusEl = document.getElementById("stripeStatus");
  const keyEl = document.getElementById("stripePublishableKey");
  if (statusEl) statusEl.textContent = "Cargando configuracion Stripe...";

  const resp = await apiRequest("/api/stripe/config", { method: "GET" });
  if (!resp.ok || !resp.data?.ok) {
    if (statusEl) statusEl.textContent = `Stripe config error: ${resp.data?.reason || "API no disponible"}`;
    return;
  }

  if (keyEl && resp.data.publishable_key) {
    keyEl.value = resp.data.publishable_key;
  }

  if (statusEl) {
    statusEl.textContent = `Stripe ${resp.data.enabled ? "activo" : "inactivo"} | Key cargada: ${resp.data.publishable_key ? "si" : "no"} | API: ${resp.base}`;
  }
}

async function initStripeAuth() {
  const statusEl = document.getElementById("stripeStatus");
  const key = (document.getElementById("stripePublishableKey")?.value || "").trim();
  if (!window.Stripe) {
    if (statusEl) statusEl.textContent = "Stripe.js no esta cargado.";
    return;
  }
  if (!key) {
    if (statusEl) statusEl.textContent = "Falta Stripe Publishable Key (pk_test...).";
    return;
  }

  stripeClient = window.Stripe(key);
  stripeElements = stripeClient.elements();

  if (stripeCard) {
    stripeCard.unmount();
  }

  stripeCard = stripeElements.create("card", {
    hidePostalCode: true
  });
  stripeCard.mount("#stripeCardElement");

  if (statusEl) statusEl.textContent = "Stripe listo. Ingresa tarjeta de prueba y ejecuta Stripe Auth.";
}

async function runStripeAuth() {
  const statusEl = document.getElementById("stripeStatus");
  if (!stripeClient || !stripeCard) {
    if (statusEl) statusEl.textContent = "Inicializa Stripe primero.";
    return;
  }

  const amount = Number(document.getElementById("stripeAmount")?.value || 1);
  const currency = (document.getElementById("stripeCurrency")?.value || "usd").trim().toLowerCase();
  const email = (document.getElementById("stripeEmail")?.value || "").trim();

  if (statusEl) statusEl.textContent = "Creando PaymentIntent...";
  const intentResp = await apiRequest("/api/stripe/create-intent", {
    method: "POST",
    body: {
      amount,
      currency,
      email
    }
  });

  if (!intentResp.ok || !intentResp.data?.ok || !intentResp.data?.client_secret) {
    if (statusEl) statusEl.textContent = `Stripe intent error: ${intentResp.data?.reason || "Error desconocido"}`;
    return;
  }

  if (statusEl) statusEl.textContent = "Confirmando tarjeta con Stripe...";
  const result = await stripeClient.confirmCardPayment(intentResp.data.client_secret, {
    payment_method: {
      card: stripeCard,
      billing_details: {
        email: email || undefined
      }
    }
  });

  if (result.error) {
    if (statusEl) statusEl.textContent = `Stripe auth rechazada: ${result.error.message}`;
    return;
  }

  if (statusEl) {
    statusEl.textContent = `Stripe aprobado | Estado: ${result.paymentIntent?.status || "N/A"} | Monto: ${intentResp.data.amount} ${String(intentResp.data.currency || "").toUpperCase()}`;
  }
}

async function initBraintreeAuth() {
  const statusEl = document.getElementById("braintreeStatus");
  if (!window.braintree?.dropin) {
    if (statusEl) statusEl.textContent = "Braintree Drop-in no esta cargado.";
    return;
  }

  if (statusEl) statusEl.textContent = "Solicitando client token de Braintree...";
  const tokenResp = await apiRequest("/api/braintree/client-token", { method: "POST" });
  if (!tokenResp.ok || !tokenResp.data?.ok || !tokenResp.data?.client_token) {
    if (statusEl) statusEl.textContent = `Braintree token error: ${tokenResp.data?.reason || "Error desconocido"}`;
    return;
  }

  if (btDropinInstance) {
    await btDropinInstance.teardown();
    btDropinInstance = null;
  }

  btDropinInstance = await window.braintree.dropin.create({
    authorization: tokenResp.data.client_token,
    container: "#btDropin"
  });

  if (statusEl) {
    statusEl.textContent = `Braintree listo | Entorno: ${tokenResp.data.environment || "sandbox"} | API: ${tokenResp.base}`;
  }
}

async function runBraintreeAuth() {
  const statusEl = document.getElementById("braintreeStatus");
  if (!btDropinInstance) {
    if (statusEl) statusEl.textContent = "Inicializa Braintree primero.";
    return;
  }

  const amount = Number(document.getElementById("stripeAmount")?.value || 1);

  try {
    if (statusEl) statusEl.textContent = "Obteniendo payment method nonce...";
    const payload = await btDropinInstance.requestPaymentMethod();
    const checkoutResp = await apiRequest("/api/braintree/checkout", {
      method: "POST",
      body: {
        payment_method_nonce: payload.nonce,
        amount
      }
    });

    if (!checkoutResp.ok || !checkoutResp.data?.ok) {
      if (statusEl) {
        statusEl.textContent = `Braintree auth rechazada: ${checkoutResp.data?.reason || "Error desconocido"}`;
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = `Braintree aprobado | Estado: ${checkoutResp.data.status || "N/A"} | Monto: ${checkoutResp.data.amount || "N/A"}`;
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = `Braintree error: ${error.message || "requestPaymentMethod failed"}`;
  }
}

function cookieString(obj) {
  return Object.entries(obj)
    .map(([k, v]) => k + "=" + v)
    .join(";");
}

function cookieBase64(obj) {
  const raw = cookieString(obj);
  return btoa(unescape(encodeURIComponent(raw)));
}

function randFrom(chars, len) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateSessionId() {
  // Formato: XXX-XXXXXXX-XXXXXXX
  const part1 = Math.floor(100 + Math.random() * 900); // 3 dígitos
  const part2 = Math.floor(1000000 + Math.random() * 9000000); // 7 dígitos
  const part3 = Math.floor(1000000 + Math.random() * 9000000); // 7 dígitos
  return `${part1}-${part2}-${part3}`;
}

function generateSessionToken() {
  // Token largo base64-like sin comillas
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  return randFrom(chars, 220);
}

function generateCsmHit() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const code = randFrom(chars, 32);
  const timestamp = Date.now();
  return `tb:${code}|${timestamp}&t:${timestamp}&adb:adblk_no`;
}

function generateRxc() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return randFrom(chars, 18);
}

function fakeEncToken(size = 180) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=";
  return "enc_gAAAAA" + randFrom(chars, size);
}

function fakeSessionToken(size = 220) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  return '"' + randFrom(chars, size) + '"';
}

function fakeXMain(size = 72) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789?";
  return '"' + randFrom(chars, size) + '"';
}

function generateAmazonLikeCookies(profile) {
  const now = Date.now();
  const sessionIdTime = String(Math.floor(now / 1000) + 31536000) + "l";

  return {
    "ubid-main": generateSessionId(),
    "session-token": generateSessionToken(),
    "i18n-prefs": profile.currency,
    "csm-hit": generateCsmHit(),
    "session-id-time": sessionIdTime,
    "id_pk": "eyJuIjoiMSJ9",
    "id_pkel": "n1",
    "lc-main": profile.locale,
    "rxc": generateRxc(),
    "session-id": generateSessionId(),
    "skin": "noskin"
  };
}

function formatCookies(obj, format) {
  if (!obj) return "";
  if (format === "amazon_like") {
    const profile = lab?.profile ?? regions.MX;
    if (!lab.amazon_like_cache) {
      lab.amazon_like_cache = generateAmazonLikeCookies(profile);
    }
    return cookieString(lab.amazon_like_cache);
  }
  if (format === "json") return JSON.stringify(obj, null, 2);
  if (format === "base64") return cookieBase64(obj);
  return cookieString(obj);
}

function getSelectedFormat() {
  return "amazon_like";
}

function parseCookiePairs(cookieText) {
  const map = {};
  if (!cookieText || !cookieText.trim()) return map;

  const parts = cookieText.split(";");
  for (const part of parts) {
    const entry = part.trim();
    if (!entry) continue;
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      return null;
    }
    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!key) {
      return null;
    }
    map[key] = value;
  }

  return map;
}

function validateFormattedCookie(formattedCookie, format) {
  if (!formattedCookie || !formattedCookie.trim()) {
    return { ok: false, reason: "Salida vacia." };
  }

  if (format === "json") {
    try {
      const parsed = JSON.parse(formattedCookie);
      if (!parsed || typeof parsed !== "object") {
        return { ok: false, reason: "JSON invalido (no es objeto)." };
      }
      return { ok: true, reason: "JSON valido." };
    } catch (error) {
      return { ok: false, reason: "JSON invalido." };
    }
  }

  if (format === "base64") {
    try {
      const decoded = decodeURIComponent(escape(atob(formattedCookie)));
      const parsed = parseCookiePairs(decoded);
      if (!parsed || Object.keys(parsed).length === 0) {
        return { ok: false, reason: "Base64 valido pero no representa pares cookie k=v." };
      }
      return { ok: true, reason: "Base64 valido y decodificable." };
    } catch (error) {
      return { ok: false, reason: "Base64 invalido." };
    }
  }

  const parsed = parseCookiePairs(formattedCookie);
  if (!parsed || Object.keys(parsed).length === 0) {
    return { ok: false, reason: "Formato cookie string invalido." };
  }

  if (format === "amazon_like") {
    const requiredKeys = [
      "ubid-main",
      "session-token",
      "i18n-prefs",
      "csm-hit",
      "session-id-time",
      "id_pk",
      "id_pkel",
      "lc-main",
      "rxc",
      "session-id",
      "skin"
    ];

    const missing = requiredKeys.filter((key) => !(key in parsed));
    if (missing.length > 0) {
      return { ok: false, reason: `Faltan claves requeridas: ${missing.join(", ")}.` };
    }

    // Validar formato ubid-main: XXX-XXXXXXX-XXXXXXX
    if (!/^\d{3}-\d{7}-\d{7}$/.test(parsed["ubid-main"])) {
      return { ok: false, reason: "ubid-main no cumple formato XXX-XXXXXXX-XXXXXXX." };
    }

    // Validar formato session-id: XXX-XXXXXXX-XXXXXXX
    if (!/^\d{3}-\d{7}-\d{7}$/.test(parsed["session-id"])) {
      return { ok: false, reason: "session-id no cumple formato XXX-XXXXXXX-XXXXXXX." };
    }

    // Validar session-id-time termina en 'l'
    if (!parsed["session-id-time"].endsWith("l")) {
      return { ok: false, reason: "session-id-time no cumple el patron esperado." };
    }

    // Validar csm-hit empieza con 'tb:'
    if (!parsed["csm-hit"].startsWith("tb:")) {
      return { ok: false, reason: "csm-hit no cumple formato esperado (debe empezar con tb:)." };
    }

    // Validar campos fijos
    if (parsed["id_pk"] !== "eyJuIjoiMSJ9") {
      return { ok: false, reason: "id_pk debe ser 'eyJuIjoiMSJ9'." };
    }

    if (parsed["id_pkel"] !== "n1") {
      return { ok: false, reason: "id_pkel debe ser 'n1'." };
    }

    if (parsed["skin"] !== "noskin") {
      return { ok: false, reason: "skin debe ser 'noskin'." };
    }

    // Validar session-token (debe ser base64-like, sin comillas)
    if (parsed["session-token"].length < 100) {
      return { ok: false, reason: "session-token parece demasiado corto." };
    }

    return {
      ok: true,
      reason: "Formato Amazon-like valido. Cookie lista para usar."
    };
  }

  return { ok: true, reason: "Cookie string valida." };
}

function getAutoApproval(profile) {
  const baseByRegion = {
    mx: 74,
    us: 78,
    es: 75,
    it: 73,
    ca: 77
  };

  const base = baseByRegion[profile.region] ?? 70;
  const score = Math.min(99, base + Math.floor(Math.random() * 12));
  return {
    score,
    status: score >= 75 ? "APPROVED" : "REJECTED"
  };
}

function getGatePolicy(gate) {
  const policies = {
    amazon: {
      minCookieScore: 70,
      riskTolerance: 0.62,
      staleSeconds: 90
    },
    paypal: {
      minCookieScore: 76,
      riskTolerance: 0.56,
      staleSeconds: 75
    },
    fwgates: {
      minCookieScore: 66,
      riskTolerance: 0.68,
      staleSeconds: 110
    }
  };

  return policies[gate] || policies.amazon;
}

function computeGateValidation(labState, gate, context = {}) {
  const policy = getGatePolicy(gate);
  const now = Date.now();
  const lastSeen = Number(labState?.cookies?.last_seen || now);
  const cookieAgeSec = Math.max(0, Math.round((now - lastSeen) / 1000));
  const formatValid = Boolean(labState?.cookie_validation?.ok);
  const verifier = labState?.verifier || {};
  const failCount = Number(verifier.failed_attempts || 0);
  const uses = Number(verifier.uses || 0);
  const maxUses = Number(verifier.max_uses || MAX_VERIFIER_USES);
  const usagePressure = maxUses > 0 ? Math.min(1, uses / maxUses) : 0;
  const stalePenalty = cookieAgeSec > policy.staleSeconds ? 20 : 0;
  const failPenalty = Math.min(36, failCount * 12);
  const usagePenalty = Math.round(usagePressure * 24);
  const formatPenalty = formatValid ? 0 : 24;
  const luhnPenalty = context.cardValid === false ? 18 : 0;

  const cookieScore = Math.max(
    0,
    100 - stalePenalty - failPenalty - usagePenalty - formatPenalty - luhnPenalty
  );

  const riskScore = Math.min(
    99,
    Math.round(
      100 - cookieScore + failCount * 7 + usagePressure * 20 + (context.apiEnabled ? 3 : 7)
    )
  );
  const riskRatio = riskScore / 100;

  let decision = "AUTHORIZED";
  let reason = "approved_gate_policy";

  if (verifier.dead) {
    decision = "REJECTED";
    reason = "cookie_dead";
  } else if (verifier.blocked) {
    decision = "REJECTED";
    reason = "cookie_blocked";
  } else if (!formatValid) {
    decision = "REJECTED";
    reason = "cookie_format_invalid";
  } else if (cookieAgeSec > policy.staleSeconds) {
    decision = "REJECTED";
    reason = "cookie_stale";
  } else if (cookieScore < policy.minCookieScore) {
    decision = "REJECTED";
    reason = "cookie_score_below_threshold";
  } else if (riskRatio > policy.riskTolerance) {
    decision = "REJECTED";
    reason = "risk_above_gate_tolerance";
  } else if (context.cardValid === false) {
    decision = "REJECTED";
    reason = "invalid_card_luhn";
  }

  return {
    decision,
    reason,
    cookieScore,
    riskScore,
    policy
  };
}

function pushHistory(type, data) {
  history.unshift({
    type: type,
    time: new Date().toLocaleTimeString(),
    data: data
  });
  history = history.slice(0, 20);
  updateHistory();
}

function updateHistory() {
  document.getElementById("history").textContent = JSON.stringify(history, null, 2);
}

function updateUI() {
  const format = getSelectedFormat();
  const formattedEl = document.getElementById("cookieFormatted");
  const inlineCookieEl = document.getElementById("cookieGeneratedInline");
  const copyStatusEl = document.getElementById("copyStatus");
  const validationStatusEl = document.getElementById("validationStatus");

  if (!lab) {
    document.getElementById("state").textContent = "";
    document.getElementById("cookies").textContent = "";
    if (formattedEl) formattedEl.value = "";
    if (inlineCookieEl) inlineCookieEl.value = "";
    if (copyStatusEl) copyStatusEl.textContent = "";
    if (validationStatusEl) {
      validationStatusEl.textContent = "";
      validationStatusEl.className = "validation-status";
    }
    const assocEl = document.getElementById("walletAssocResult");
    if (assocEl) assocEl.textContent = "";
    updateVerifierStatusPanel();
    return;
  }

  const formattedCookie = formatCookies(lab.cookies, format);
  const validation = validateFormattedCookie(formattedCookie, format);
  lab.cookie_format = format;
  lab.cookie_output = formattedCookie;
  lab.cookie_validation = validation;

  // state oculto - no mostrar JSON completo
  document.getElementById("state").textContent = "";
  document.getElementById("cookies").textContent = cookieString(lab.cookies);
  
  if (formattedEl) {
    formattedEl.value = formattedCookie;
    log("UI", `Cookie actualizada en textarea (${formattedCookie.length} caracteres, formato: ${format})`);
  } else {
    log("ERROR", "Elemento cookieFormatted no encontrado");
  }

  if (inlineCookieEl) {
    inlineCookieEl.value = formattedCookie;
  }
  
  if (copyStatusEl) copyStatusEl.textContent = "";
  if (validationStatusEl) {
    validationStatusEl.textContent = `${validation.ok ? "Valida" : "No valida"}: ${validation.reason}`;
    validationStatusEl.className = `validation-status ${validation.ok ? "ok" : "bad"}`;
  }

  const assocEl = document.getElementById("walletAssocResult");
  if (assocEl) {
    if (!lab.wallet_association_test) {
      assocEl.textContent = "Aun no se ha ejecutado una prueba de asociacion.";
    } else {
      const assoc = lab.wallet_association_test.association || {};
      assocEl.textContent = [
        "Resultado de asociacion",
        `Estado: ${assoc.status || lab.wallet_association_test.status || "N/A"}`,
        `Mensaje: ${assoc.status_message || "N/A"}`,
        `Razon: ${assoc.reason || "N/A"}`,
        `Cobro real: ${lab.wallet_association_test.no_charge ? "No" : "Si"}`
      ].join("\n");
    }
  }

  updateVerifierStatusPanel();
}

function getAmazonCookieSource() {
  // Detección automática basada en contenido del textarea
  const sampleEl = document.getElementById("sampleCookie");
  const cookieContent = (sampleEl?.value || "").trim();
  
  // Si hay contenido significativo (más de 20 caracteres), es cookie externa
  // Si está vacío o tiene muy poco contenido, intentar generar con API
  return cookieContent.length > 20 ? "external" : "generated";
}

async function runLab(options = {}) {
  if (isGenerating) return;

  const skipCooldown = options.skipCooldown === true;
  const now = Date.now();
  const remainingMs = COOKIE_GENERATE_COOLDOWN_MS - (now - lastCookieGenerationAt);
  const cooldownApplies = flowMode === "amazon-cookies";
  if (cooldownApplies && !skipCooldown && lastCookieGenerationAt > 0 && remainingMs > 0) {
    const left = formatCooldownRemaining(remainingMs);
    const msg = `Debes esperar ${left} para generar la siguiente cookie.`;
    setStatus(msg, "running");
    if (flowMode === "amazon-cookies") {
      setCookieGenerateStatus("error", msg);
    }
    log("COOKIE", `Cooldown activo: ${left} restantes`);
    return false;
  }

  const cardsCheck = ensureCardsReady();
  if (!cardsCheck.ok) {
    reflectCardInputIssue("missing_card_input", cardsCheck.message || "CARD_MISSING");
    setStatus(cardsCheck.message || "No hay tarjetas validas para iniciar.", "running");
    log("CARDS", cardsCheck.message || "Tarjetas invalidas o vacias");
    return false;
  }

  if (Array.isArray(cardsCheck.discarded) && cardsCheck.discarded.length) {
    log("CARDS", `Descartadas por formato/Luhn: ${cardsCheck.discarded.length}`);
  }

  isGenerating = true;
  if (flowMode === "amazon-cookies") {
    setCookieGenerateStatus("generating", "Generando cookie...");
  }
  const disableButtons = options.disableButtons !== false;
  if (disableButtons) toggleBtns(true);

  const region = document.getElementById("region").value;
  const alias = "Wallet Principal";
  const processMs = options.fast
    ? Math.max(250, Number(options.fastDelayMs) || 600)
    : MIN_DELAY +
      Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1));

  try {
    setStatus("Iniciando proceso de generacion...", "running");
    await runSlowGenerationTimer(processMs);

  const profile = regions[region];
  const wallet = createWallet(alias);
  const source = createSource();

  wallet.wallet_state = "wallet_active";
  source.source_state = "source_linked";

  let cookies = generateCookies(profile, wallet, source);
  if (importer.importedAddress) {
    cookies.bridge_address = importer.importedAddress;
  }

  const amazonCookieSource = getAmazonCookieSource();
  const isAmazonFlow = flowMode === "amazon-cookies";

  if (isAmazonFlow) {
    const sampleText = document.getElementById("sampleCookie")?.value || "";
    const parsedRealCookie = parseCookiePairs(sampleText);
    if (Object.keys(parsedRealCookie).length) {
      cookies = {
        ...cookies,
        ...parsedRealCookie,
        source_mode: amazonCookieSource === "external" ? "amazon_external_cookie" : "real_cookie_input",
        source_state: "real_cookie_loaded",
        last_seen: Date.now()
      };
    }
  }
  const approval = getAutoApproval(profile);

  let apiMode = {
    enabled: false,
    reason: ownerSession.access_key
      ? "API no conectada"
      : "Sin key de acceso. Inicia sesion de propietario y genera key."
  };

  if (isAmazonFlow) {
    apiMode = {
      enabled: false,
      external_cookie_mode: amazonCookieSource === "external",
      reason:
        "Modo Amazon Cookies activo: la validacion se ejecuta con cookie local/formateada sin crear sesion API."
    };
  } else if (ownerSession.access_key) {
    try {
      const sessionResp = await createApiSimulationSession(region);
      if (sessionResp.ok && sessionResp.data?.ok) {
        const simCookie = sessionResp.data.cookie;
        const walletResp = await openApiWallet(simCookie, alias);
        if (walletResp.ok && walletResp.data?.ok) {
          apiMode = {
            enabled: true,
            simulation_only: true,
            no_charge: true,
            api_base: sessionResp.base,
            cookie: simCookie,
            wallet_id: walletResp.data.wallet.wallet_id,
            policy: sessionResp.data.policy,
            key_profile: sessionResp.data.key_profile
          };
          cookies.sim_cookie = simCookie;
        } else {
          apiMode = {
            enabled: false,
            reason: walletResp.data?.reason || "No se pudo abrir wallet en API"
          };
        }
      } else {
        apiMode = {
          enabled: false,
          reason: sessionResp.data?.reason || "No se pudo crear sesion API"
        };
      }
    } catch (error) {
      apiMode = {
        enabled: false,
        reason: "No se pudo conectar a APIs disponibles (primary/backup)"
      };
    }
  } else {
    apiMode = {
      enabled: false,
      reason: "Flow Gate API requiere Access Key. Ejecuta Owner Login y Generate Key."
    };
  }

    lab = {
      profile,
      wallet,
      source,
      cookies,
      approval,
      api_mode: apiMode,
      test_mode: {
        charge_enabled: false,
        method: "luhn_demo_auto"
      },
      test_policy:
        "Cookie temporal de entorno de prueba: puede invalidarse tras multiples usos y se bloquea despues de varios intentos fallidos consecutivos en verificacion.",
      lab_state: "session_active",
      gate: selectedGate
    };

    updateUI();
    pushHistory("LAB_RUN", lab);
    setStatus("Generacion completada. Cookie lista para copiar.", "done");
    if (flowMode === "amazon-cookies") {
      lastCookieGenerationAt = Date.now();
    }
    if (flowMode === "amazon-cookies") {
      setCookieGenerateStatus("done", "Cookie generada correctamente.");
    }
    setProgress(1, 1);
    return true;
  } catch (error) {
    if (error?.message === "generation_cancelled") {
      setStatus("Proceso detenido por usuario.", "running");
    } else {
      setStatus("Error durante la generacion.", "running");
    }
    if (flowMode === "amazon-cookies") {
      setCookieGenerateStatus("error", "Error al generar cookie.");
    }
    return false;
  } finally {
    if (disableButtons) toggleBtns(false);
    isGenerating = false;
  }
}

function getDefaultRiskModeByGate(gate) {
  const byGate = {
    amazon: "balanced",
    paypal: "strict",
    fwgates: "balanced"
  };
  return byGate[gate] || "balanced";
}

async function ensureGateApiAccess() {
  if (ownerSession.access_key) return true;

  const username = (document.getElementById("ownerUser")?.value || "owner").trim() || "owner";
  const password = document.getElementById("ownerPass")?.value || "owner123";
  const profileId = (document.getElementById("profileId")?.value || "mi_perfil").trim() || "mi_perfil";
  const ttlMinutes = Number(document.getElementById("keyTtl")?.value || 30);

  const loginResp = await ownerLoginApi(username, password);
  if (!loginResp.ok || !loginResp.data?.ok) {
    setStatus("Gate API: no se pudo autenticar owner automáticamente.", "running");
    log("API", `Owner login auto falló: ${loginResp.data?.reason || "credenciales invalidas"}`);
    return false;
  }

  ownerSession.owner_token = loginResp.data.owner_token;

  const keyResp = await ownerGenerateKeyApi(profileId, ttlMinutes);
  if (!keyResp.ok || !keyResp.data?.ok) {
    setStatus("Gate API: no se pudo generar access key automáticamente.", "running");
    log("API", `Generate key auto falló: ${keyResp.data?.reason || "solicitud invalida"}`);
    return false;
  }

  ownerSession.access_key = keyResp.data.access_key;
  const accessKeyEl = document.getElementById("ownerAccessKey");
  if (accessKeyEl) accessKeyEl.value = keyResp.data.access_key;
  log("API", `Access key auto generada para profile ${keyResp.data.profile_id || profileId}`);
  return true;
}

async function ensureGateApiSession() {
  const apiOnline = await connectGateApi();
  if (!apiOnline) return false;

  const hasAccess = await ensureGateApiAccess();
  if (!hasAccess) return false;

  const riskModeEl = document.getElementById("riskModeSelect");
  if (riskModeEl) {
    riskModeEl.value = getDefaultRiskModeByGate(selectedGate);
  }

  const ok = await runLab({ fast: true, fastDelayMs: 700, disableButtons: false, skipCooldown: true });
  if (!ok) return false;

  if (!lab?.api_mode?.enabled) {
    setStatus("Gate API no pudo abrir sesion/wallet para validar tarjetas.", "running");
    log("API", "Sesion API no habilitada en modo Gate Auth");
    return false;
  }

  return true;
}

function refreshSession() {
  if (!lab) return;

  lab.cookies.session_id = "session_" + rand(12);
  lab.cookies.auth_token = "auth_" + rand(20);
  lab.cookies.last_seen = Date.now();
  lab.cookies.metrics = "metrics_" + rand(6);
  lab.amazon_like_cache = null;

  updateUI();
  pushHistory("SESSION_REFRESH", lab.cookies);
}

function unlinkSource() {
  if (!lab) {
    log("CLEAN", "No hay cookie para limpiar");
    return;
  }

  lab = null;
  updateUI();
  pushHistory("COOKIE_CLEARED", { action: "cookie_removed" });
  setStatus("Cookie eliminada. Genera o carga una nueva para continuar.", "done");
  log("CLEAN", "Cookie limpiada correctamente");
}

function clearLab() {
  lab = null;
  updateUI();
  pushHistory("LAB_CLEARED", {});
}

async function ownerLogin() {
  const ownerStatusEl = document.getElementById("ownerStatus");
  const username = (document.getElementById("ownerUser")?.value || "").trim();
  const password = document.getElementById("ownerPass")?.value || "";

  ownerStatusEl.textContent = "Autenticando propietario...";
  try {
    const resp = await ownerLoginApi(username, password);
    if (!resp.ok || !resp.data?.ok) {
      ownerSession.owner_token = "";
      ownerSession.access_key = "";
      const accessKeyEl = document.getElementById("ownerAccessKey");
      if (accessKeyEl) accessKeyEl.value = "";
      ownerStatusEl.textContent = `Error login: ${resp.data?.reason || "credenciales invalidas"}`;
      syncRoleViewAccess();
      return;
    }

    ownerSession.owner_token = resp.data.owner_token;
    ownerSession.access_key = "";
    const accessKeyEl = document.getElementById("ownerAccessKey");
    if (accessKeyEl) accessKeyEl.value = "";
    ownerStatusEl.textContent = `Login correcto | Owner: ${resp.data.owner} | Expira en ${resp.data.expires_in_minutes} min`;
    syncRoleViewAccess();
  } catch (error) {
    ownerSession.owner_token = "";
    ownerSession.access_key = "";
    syncRoleViewAccess();
    ownerStatusEl.textContent = "No se pudo conectar con API para login.";
  }
}

async function generateOwnerAccessKey() {
  const ownerStatusEl = document.getElementById("ownerStatus");
  const accessKeyEl = document.getElementById("ownerAccessKey");
  const profileId = (document.getElementById("profileId")?.value || "").trim();
  const ttlMinutes = Number(document.getElementById("keyTtl")?.value || 30);

  if (!ownerSession.owner_token) {
    ownerStatusEl.textContent = "Primero inicia sesion como propietario.";
    return;
  }

  ownerStatusEl.textContent = "Generando key de acceso...";
  try {
    const resp = await ownerGenerateKeyApi(profileId, ttlMinutes);
    if (!resp.ok || !resp.data?.ok) {
      ownerStatusEl.textContent = `Error al generar key: ${resp.data?.reason || "solicitud invalida"}`;
      return;
    }

    ownerSession.access_key = resp.data.access_key;
    accessKeyEl.value = resp.data.access_key;
    ownerStatusEl.textContent = `Key generada | Perfil: ${resp.data.profile_id} | TTL: ${resp.data.ttl_minutes} min`;
    syncRoleViewAccess();
    setRoleView("admin");
  } catch (error) {
    ownerStatusEl.textContent = "No se pudo conectar con API para generar key.";
  }
}

function updateSelectedFormat() {
  if (lab) {
    lab.amazon_like_cache = null;
  }
  updateUI();
}

async function copyFormattedCookie() {
  const formattedEl = document.getElementById("cookieFormatted");
  const copyStatusEl = document.getElementById("copyStatus");
  const text = formattedEl.value;

  if (flowMode === "amazon-cookies") {
    copyStatusEl.textContent = "Copia deshabilitada en modo Amazon Cookies.";
    return;
  }

  if (!text) {
    copyStatusEl.textContent = "No hay cookie para copiar.";
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      formattedEl.focus();
      formattedEl.select();
      document.execCommand("copy");
      formattedEl.setSelectionRange(0, 0);
    }
    copyStatusEl.textContent = "Copiado correctamente.";
  } catch (error) {
    copyStatusEl.textContent = "No se pudo copiar automaticamente.";
  }
}

async function runWalletAssociationTest(cardOverride = null) {
  if (!lab) {
    setStatus("Primero genera la cookie/laboratorio para ejecutar la asociacion.", "running");
    return "NO_SESSION";
  }

  if (!lab.verifier) {
    lab.verifier = {
      uses: 0,
      failed_attempts: 0,
      max_uses: MAX_VERIFIER_USES,
      max_failed_attempts: MAX_FAILED_ATTEMPTS,
      blocked: false,
      dead: false,
      last_event: "created"
    };
  }

  if (lab.verifier.blocked || lab.verifier.dead) {
    const blockedStatus = lab.verifier.blocked ? "CARD_BLOCKED" : "CARD_DISABLED";
    lab.wallet_association_test = {
      test_id: `assoc_${Date.now()}`,
      method: "amazon_like_no_cvv_mock",
      no_charge: true,
      status: blockedStatus,
      status_message: getMsg(blockedStatus),
      reason: lab.verifier.blocked ? "cookie_blocked" : "cookie_dead",
      verifier: { ...lab.verifier },
      result_catalog: {
        safe_status: blockedStatus,
        ordered_output: SAFE_OUTPUTS
      },
      created_at: new Date().toISOString()
    };
    setStatus("Cookie bloqueada/invalida. Reinicia sesion para nuevas pruebas.", "running");
    pushHistory("WALLET_ASSOC_DENIED", lab.wallet_association_test);
    updateUI();
    return blockedStatus;
  }

  const gateMethodBySelection = {
    amazon: "amazon_like_no_cvv_mock",
    paypal: "paypal_tokenized_mock",
    fwgates: "fw_custom_rules_mock"
  };

  const rejectChanceByGate = {
    amazon: 0.35,
    paypal: 0.42,
    fwgates: 0.3
  };

  const activeWallet = {
    wallet_id: lab?.api_mode?.wallet_id || lab?.wallet?.wallet_id || `wallet_test_${rand(8)}`,
    wallet_state: lab?.wallet?.wallet_state || "wallet_opened_test",
    mode: "no_charge"
  };

  const importedCard = cardOverride && cardOverride.cardNumber ? cardOverride : nextCard();
  if (!importedCard || !importedCard.cardNumber) {
    const missingStatus = "CARD_MISSING";
    lab.wallet_association_test = {
      test_id: `assoc_${Date.now()}`,
      method: "card_input_precheck",
      no_charge: true,
      cookie_state: lab.cookie_validation?.ok ? "valid" : "invalid",
      card: {
        card_number: null,
        masked: null,
        luhn_valid: false,
        imported: false,
        exp_month: null,
        exp_year: null,
        cvv: null
      },
      association: {
        status: missingStatus,
        status_message: "CARD_MISSING",
        reason: "missing_card_input"
      },
      result_catalog: {
        ordered_output: SAFE_OUTPUTS
      },
      verifier: lab.verifier ? { ...lab.verifier } : null,
      created_at: new Date().toISOString()
    };

    registerAssociationResult(missingStatus, lab.cookies.cookie_state || "active");
    setStatus("Tarjeta inexistente. No se consulto API.", "running");
    pushHistory("WALLET_ASSOC_TEST", lab.wallet_association_test);
    updateUI();
    return missingStatus;
  }

  const cardNumber = importedCard.cardNumber;
  const cardValid = luhnCheck(cardNumber);
  if (!cardValid) {
    const invalidStatus = "CARD_INVALID";
    lab.wallet_association_test = {
      test_id: `assoc_${Date.now()}`,
      method: "card_input_precheck",
      no_charge: true,
      cookie_state: lab.cookie_validation?.ok ? "valid" : "invalid",
      card: {
        card_number: cardNumber,
        masked: `**** **** **** ${String(cardNumber).slice(-4)}`,
        luhn_valid: false,
        imported: true,
        exp_month: importedCard?.expMonth || null,
        exp_year: importedCard?.expYear || null,
        cvv: importedCard?.cvv || null
      },
      association: {
        status: invalidStatus,
        status_message: "CARD_INVALID",
        reason: "invalid_card_luhn"
      },
      result_catalog: {
        ordered_output: SAFE_OUTPUTS
      },
      verifier: lab.verifier ? { ...lab.verifier } : null,
      created_at: new Date().toISOString()
    };

    registerAssociationResult(invalidStatus, lab.cookies.cookie_state || "active");
    setStatus("Tarjeta sin Luhn descartada. No se consulto API.", "running");
    pushHistory("WALLET_ASSOC_TEST", lab.wallet_association_test);
    updateUI();
    return invalidStatus;
  }

  const cardExpired = isCardExpired(importedCard?.expMonth, importedCard?.expYear);
  if (cardExpired) {
    const invalidStatus = "CARD_INVALID";
    lab.wallet_association_test = {
      test_id: `assoc_${Date.now()}`,
      method: "card_input_precheck",
      no_charge: true,
      cookie_state: lab.cookie_validation?.ok ? "valid" : "invalid",
      card: {
        card_number: cardNumber,
        masked: `**** **** **** ${String(cardNumber).slice(-4)}`,
        luhn_valid: true,
        imported: true,
        exp_month: importedCard?.expMonth || null,
        exp_year: importedCard?.expYear || null,
        cvv: importedCard?.cvv || null
      },
      association: {
        status: invalidStatus,
        status_message: "CARD_INVALID",
        reason: "invalid_card_expired"
      },
      result_catalog: {
        ordered_output: SAFE_OUTPUTS
      },
      verifier: lab.verifier ? { ...lab.verifier } : null,
      created_at: new Date().toISOString()
    };

    registerAssociationResult(invalidStatus, lab.cookies.cookie_state || "active");
    setStatus("Tarjeta expirada descartada. No se consulto API.", "running");
    pushHistory("WALLET_ASSOC_TEST", lab.wallet_association_test);
    updateUI();
    return invalidStatus;
  }

  const rejectChance = rejectChanceByGate[selectedGate] ?? 0.35;
  const gateEvalPreview = computeGateValidation(lab, selectedGate, {
    cardValid,
    apiEnabled: Boolean(lab.api_mode?.enabled)
  });
  const randomPass = Math.random() > rejectChance;
  const shouldAuthorize = cardValid && randomPass && gateEvalPreview.decision === "AUTHORIZED";

  const apiEnabled = Boolean(lab.api_mode?.enabled && lab.api_mode?.cookie && lab.api_mode?.wallet_id);

  if (apiEnabled) {
    try {
      const resp = await associateApiCard(lab.api_mode.cookie, lab.api_mode.wallet_id, cardNumber);
      const ok = Boolean(resp.data?.ok);
      const incomingStatus = resp.data?.status_code || resp.data?.result || (ok ? "AUTHORIZED" : "REJECTED");
      const normalizedIncomingStatus = normalizeSafeStatus(incomingStatus, resp.data?.reason, {
        gate: selectedGate,
        apiEnabled: true,
        verifier: resp.data?.verifier || null
      });
      const gateEval = computeGateValidation(lab, selectedGate, {
        cardValid,
        apiEnabled: true
      });
      const apiDecision = resp.data?.decision || null;
      const apiAccepted = SUCCESS_STATUS_SET.has(normalizedIncomingStatus);
      const finalStatus = apiAccepted && gateEval.decision === "AUTHORIZED"
        ? resolveSuccessStatus(selectedGate, true)
        : normalizeSafeStatus(
          "REJECTED",
          gateEval.reason || resp.data?.reason || "association_failed",
          {
            gate: selectedGate,
            apiEnabled: true,
            verifier: resp.data?.verifier || null
          }
        );

      lab.wallet_association_test = {
        test_id: `assoc_${Date.now()}`,
        method: `${gateMethodBySelection[selectedGate] || "generic"}_api`,
        no_charge: true,
        cookie_state: lab.cookie_validation?.ok ? "valid" : "invalid",
        wallet: {
          wallet_id: activeWallet.wallet_id,
          wallet_state: activeWallet.wallet_state,
          mode: activeWallet.mode
        },
        card: {
          card_number: cardNumber,
          masked: `**** **** **** ${cardNumber.slice(-4)}`,
          luhn_valid: cardValid,
          imported: Boolean(importedCard),
          exp_month: importedCard?.expMonth || null,
          exp_year: importedCard?.expYear || null,
          cvv: importedCard?.cvv || null
        },
        association: {
          status: finalStatus,
          status_message: "",
          reason: apiAccepted && gateEval.decision === "AUTHORIZED"
            ? "approved_api_and_gate"
            : gateEval.reason || resp.data?.reason || "association_failed"
        },
        result_catalog: {
          ordered_output: SAFE_OUTPUTS
        },
        gate_validation: {
          cookie_score: gateEval.cookieScore,
          risk_score: typeof apiDecision?.risk_score === "number" ? apiDecision.risk_score : gateEval.riskScore,
          policy: gateEval.policy,
          api_decision: apiDecision
        },
        verifier: resp.data?.verifier || null,
        created_at: new Date().toISOString()
      };

      if (!SUCCESS_STATUS_SET.has(finalStatus) && lab.wallet_association_test?.verifier?.blocked) {
        lab.cookies.cookie_state = "blocked";
      }
      if (lab.wallet_association_test?.verifier?.dead) {
        lab.cookies.cookie_state = "dead";
      }

      lab.wallet_association_test.association.status_message = getMsg(
        lab.wallet_association_test.association.status
      );

      registerAssociationResult(
        lab.wallet_association_test.association.status,
        lab.cookies.cookie_state || "active"
      );

      setStatus(
        lab.wallet_association_test.association.status === "AUTHORIZED"
          ? "Asociacion API autorizada (sin cargos)."
          : "Asociacion API rechazada o bloqueada (sin cargos).",
        lab.wallet_association_test.association.status === "AUTHORIZED" ? "done" : "running"
      );

      pushHistory("WALLET_ASSOC_TEST", lab.wallet_association_test);
      updateUI();
      return lab.wallet_association_test.association.status;
    } catch (error) {
      setStatus("Fallo en verificacion API. Usando simulacion local.", "running");
      return "API_ERROR";
    }
  }

  lab.verifier.uses += 1;
  if (lab.verifier.uses >= lab.verifier.max_uses) {
    lab.verifier.dead = true;
    lab.verifier.last_event = "cookie_expired_by_use";
    lab.cookies.cookie_state = "dead";
  }

  if (!shouldAuthorize) {
    lab.verifier.failed_attempts += 1;
    lab.verifier.last_event = "association_failed";
    if (lab.verifier.failed_attempts >= lab.verifier.max_failed_attempts) {
      lab.verifier.blocked = true;
      lab.cookies.cookie_state = "blocked";
      lab.verifier.last_event = "cookie_blocked_by_failures";
    }
  } else {
    lab.verifier.failed_attempts = 0;
    lab.verifier.last_event = "association_authorized";
  }

  lab.wallet_association_test = {
    test_id: `assoc_${Date.now()}`,
    method: gateMethodBySelection[selectedGate] || "generic_no_charge_mock",
    no_charge: true,
    cookie_state: lab.cookie_validation?.ok ? "valid" : "invalid",
    wallet: activeWallet,
    card: {
      card_number: cardNumber,
      masked: `**** **** **** ${cardNumber.slice(-4)}`,
      luhn_valid: cardValid,
      imported: Boolean(importedCard),
      exp_month: importedCard?.expMonth || null,
      exp_year: importedCard?.expYear || null,
      cvv: importedCard?.cvv || null
    },
    association: {
      status: normalizeSafeStatus(
        shouldAuthorize ? resolveSuccessStatus(selectedGate, false) : "REJECTED",
        shouldAuthorize ? "approved_gate_policy" : gateEvalPreview.reason,
        {
          gate: selectedGate,
          apiEnabled: false,
          verifier: lab.verifier
        }
      ),
      status_message: "",
      reason: shouldAuthorize ? "approved_gate_policy" : gateEvalPreview.reason
    },
    result_catalog: {
      ordered_output: SAFE_OUTPUTS
    },
    gate_validation: {
      cookie_score: gateEvalPreview.cookieScore,
      risk_score: gateEvalPreview.riskScore,
      policy: gateEvalPreview.policy
    },
    verifier: { ...lab.verifier },
    created_at: new Date().toISOString()
  };

  registerAssociationResult(
    lab.wallet_association_test.association.status,
    lab.cookies.cookie_state || "active"
  );

  lab.wallet_association_test.association.status_message = getMsg(
    lab.wallet_association_test.association.status
  );

  setStatus(
    shouldAuthorize
      ? "Asociacion de prueba autorizada (sin cargos)."
      : "Asociacion de prueba rechazada por validacion/riesgo (sin cargos).",
    shouldAuthorize ? "done" : "running"
  );

  pushHistory("WALLET_ASSOC_TEST", lab.wallet_association_test);
  updateUI();
  return lab.wallet_association_test.association.status;
}

async function runSingleCycle() {
  const jobId = addJob("single", "Run 1");
  updJob(jobId, "processing", "Generando");
  log("RUN", "Run 1 iniciado");
  const ok = await runLab({ fast: true, fastDelayMs: 900, disableButtons: false });
  if (!ok || checker.stopRequested) {
    updJob(jobId, "stopped", "Cancelado durante generacion");
    log("STOP", "Run 1 cancelado");
    return;
  }
  const assocStatus = await runWalletAssociationTest();
  const assocMessage = getMsg(assocStatus);
  updJob(
    jobId,
    SUCCESS_STATUS_SET.has(assocStatus) ? "live" : "dead",
    `[${assocStatus || "UNKNOWN"}] ${assocMessage}`
  );
  log("RUN", `Run 1 finalizado con [${assocStatus || "UNKNOWN"}] ${assocMessage}`);
}

async function runBatchNow() {
  const count = Math.max(1, Number(document.getElementById("batchSize")?.value || 1));
  const delayMs = Math.max(0, Number(document.getElementById("loopDelayMs")?.value || 0));

  toggleCtrl(true);
  checker.running = true;
  checker.stopRequested = false;
  checker.current = 0;
  checker.total = count;

  try {
    for (let i = 0; i < count; i++) {
      if (checker.stopRequested) break;
      const jobId = addJob("batch", `Item ${i + 1}/${count}`);
      updJob(jobId, "processing", "Generando");
      checker.current = i + 1;
      setStatus(`Batch ${checker.current}/${checker.total} en proceso...`, "running");
      log("BATCH", `Item ${checker.current}/${checker.total} iniciado`);
      const ok = await runLab({ fast: true, fastDelayMs: 700, disableButtons: false });
      if (!ok || checker.stopRequested) {
        updJob(jobId, "stopped", "Cancelado durante generacion");
        break;
      }
      const assocStatus = await runWalletAssociationTest(card);
      const assocMessage = getMsg(assocStatus);
      updJob(
        jobId,
        SUCCESS_STATUS_SET.has(assocStatus) ? "live" : "dead",
        `[${assocStatus || "UNKNOWN"}] ${assocMessage}`
      );
      log(
        "BATCH",
        `Item ${checker.current}/${checker.total}: [${assocStatus || "UNKNOWN"}] ${assocMessage}`
      );
      if (delayMs > 0) await sleep(delayMs);
    }
  } finally {
    checker.running = false;
    toggleCtrl(false);
    setStatus(
      checker.stopRequested
        ? `Batch detenido en ${checker.current}/${checker.total}`
        : `Batch completado (${checker.current}/${checker.total})`,
      checker.stopRequested ? "running" : "done"
    );
    checker.stopRequested = false;
  }
}

async function startCardValidation() {
  if (checker.running) {
    log("VALIDATION", "Validación ya en progreso");
    return;
  }

  if (flowMode === "gate-auth") {
    const ready = await ensureGateApiSession();
    if (!ready) return;
  }

  if (flowMode === "amazon-cookies" && !lab) {
    const loaded = loadPastedCookie();
    if (!loaded) {
      // En validacion Amazon, la preparacion de sesion no debe frenarse por cooldown.
      await runLab({ fast: true, fastDelayMs: 700, disableButtons: false, skipCooldown: true });
    }
  }

  if (flowMode === "amazon-cookies" && lab) {
    // Normaliza estructura minima para poder emular asociacion a wallet siempre.
    if (!lab.wallet?.wallet_id) {
      lab.wallet = createWallet("Wallet Principal");
      lab.wallet.wallet_state = "wallet_active";
    }
    if (!lab.source?.source_id) {
      lab.source = createSource();
      lab.source.source_state = "source_linked";
    }
    if (!lab.api_mode) {
      lab.api_mode = {
        enabled: false,
        external_cookie_mode: true,
        reason: "Modo emulado local para asociacion a wallet"
      };
    }
    log("VALIDATION", "Conexion emulada lista: wallet/source preparados en modo Amazon");
  }
  
  // Verificar que hay cookie disponible (generada o pegada)
  if (!lab || !lab.cookies) {
    setStatus("Primero genera o carga una cookie Amazon antes de validar tarjetas.", "running");
    log("VALIDATION", "Error: No hay cookie disponible");
    return;
  }
  
  // Verificar que hay tarjetas para validar
  const cardsCheck = ensureCardsReady();
  if (!cardsCheck.ok) {
    setStatus(cardsCheck.message || "No hay tarjetas para validar.", "running");
    log("VALIDATION", cardsCheck.message || "No hay tarjetas válidas");
    return;
  }
  
  log("VALIDATION", `Iniciando validación con ${cardsCheck.cards.length} tarjetas usando cookie existente`);
  
  checker.running = true;
  checker.stopRequested = false;
  checker.current = 0;
  checker.total = cardsCheck.cards.length;
  toggleCtrl(true);
  setStatus("Validación de tarjetas iniciada...", "running");
  
  try {
    for (let i = 0; i < cardsCheck.cards.length; i++) {
      if (checker.stopRequested) break;
      
      const card = cardsCheck.cards[i];
      checker.current = i + 1;
      
      const jobId = addJob("validation", `Tarjeta ${i + 1}/${cardsCheck.cards.length}`);
      updJob(jobId, "processing", `Validando ${card.cardNumber.slice(-4)}...`);
      setStatus(`Validando tarjeta ${checker.current}/${checker.total}...`, "running");
      
      // Simular delay de procesamiento
      await sleep(800 + Math.random() * 400);
      
      // Validar tarjeta usando la cookie existente
      const assocStatus = await runWalletAssociationTest(card);
      const assocMessage = getMsg(assocStatus);
      
      updJob(
        jobId,
        SUCCESS_STATUS_SET.has(assocStatus) ? "live" : "dead",
        `[${assocStatus}] ${assocMessage} - ${card.cardNumber.slice(-4)}`
      );
      
      log(
        "VALIDATION",
        `Tarjeta ${checker.current}/${checker.total} [${card.cardNumber.slice(-4)}]: ${assocStatus} - ${assocMessage}`
      );
      
      // Delay entre validaciones
      const delayMs = Math.max(0, Number(document.getElementById("loopDelayMs")?.value || 500));
      if (delayMs > 0 && i < cardsCheck.cards.length - 1) {
        await sleep(delayMs);
      }
    }
    
    setStatus(
      checker.stopRequested 
        ? `Validación detenida (${checker.current}/${checker.total} procesadas)`
        : `Validación completada (${checker.total} tarjetas procesadas)`,
      checker.stopRequested ? "running" : "done"
    );
    log("VALIDATION", `Validación finalizada: ${checker.current}/${checker.total} tarjetas procesadas`);
    
  } catch (error) {
    setStatus("Error durante la validación de tarjetas.", "running");
    log("ERROR", `Error en validación: ${error.message || error}`);
  } finally {
    checker.running = false;
    checker.stopRequested = false;
    toggleCtrl(false);
  }
}

async function trySingleAssociationNow() {
  if (checker.running) {
    setStatus("Hay una validacion en progreso. Detenla para intentar manualmente.", "running");
    return;
  }

  if (flowMode === "gate-auth") {
    const ready = await ensureGateApiSession();
    if (!ready) return;
  }

  if (!lab || !lab.cookies) {
    setStatus(
      flowMode === "gate-auth"
        ? "No hay sesion API activa para Gate Auth."
        : "Primero genera o carga una cookie Amazon.",
      "running"
    );
    return;
  }

  const cardsCheck = ensureCardsReady();
  if (!cardsCheck.ok || !cardsCheck.cards.length) {
    setStatus(cardsCheck.message || "No hay tarjetas validas para asociar.", "running");
    return;
  }

  const card = cardsCheck.cards[0];
  const jobId = addJob("manual-assoc", `Manual ${String(card.cardNumber).slice(-4)}`);
  updJob(jobId, "processing", "Intentando asociacion emulada...");

  try {
    const assocStatus = await runWalletAssociationTest(card);
    const assocMessage = getMsg(assocStatus);
    const isLive = SUCCESS_STATUS_SET.has(assocStatus);
    updJob(
      jobId,
      isLive ? "live" : "dead",
      `[${assocStatus || "UNKNOWN"}] ${assocMessage} - ${String(card.cardNumber).slice(-4)}`
    );
    setStatus(
      isLive
        ? `Asociacion manual autorizada: ${String(card.cardNumber).slice(-4)}`
        : `Asociacion manual rechazada: ${String(card.cardNumber).slice(-4)}`,
      isLive ? "done" : "running"
    );
  } catch (error) {
    updJob(jobId, "error", `Error: ${error?.message || "unknown"}`);
    setStatus("Error en asociacion manual.", "running");
    log("ERROR", `Asociacion manual fallo: ${error?.message || error}`);
  }
}

async function startCheckerLoop() {
  if (checker.running) return;

  // Validación de términos eliminada - checkbox removido

  const perBatch = Math.max(1, Number(document.getElementById("batchSize")?.value || 10));
  const delayMs = Math.max(0, Number(document.getElementById("loopDelayMs")?.value || 0));
  checker.running = true;
  checker.stopRequested = false;
  toggleCtrl(true);
  setStatus("Checker loop iniciado.", "running");

  try {
    while (!checker.stopRequested) {
      checker.current = 0;
      checker.total = perBatch;
      log("LOOP", `Nueva ronda loop (batch=${perBatch}, delay=${delayMs}ms)`);
      for (let i = 0; i < perBatch; i++) {
        if (checker.stopRequested) break;
        const jobId = addJob("loop", `Item ${i + 1}/${perBatch}`);
        updJob(jobId, "processing", "Generando");
        checker.current = i + 1;
        const ok = await runLab({ fast: true, fastDelayMs: 650, disableButtons: false });
        if (!ok || checker.stopRequested) {
          updJob(jobId, "stopped", "Cancelado durante generacion");
          break;
        }
        const assocStatus = await runWalletAssociationTest();
        const assocMessage = getMsg(assocStatus);
        updJob(
          jobId,
          SUCCESS_STATUS_SET.has(assocStatus) ? "live" : "dead",
          `[${assocStatus || "UNKNOWN"}] ${assocMessage}`
        );
        log(
          "LOOP",
          `Item ${checker.current}/${checker.total}: [${assocStatus || "UNKNOWN"}] ${assocMessage}`
        );
        if (delayMs > 0) await sleep(delayMs);
      }
      if (checker.stopRequested) break;
    }
  } finally {
    checker.running = false;
    toggleCtrl(false);
    setStatus("Checker loop detenido.", "done");
    checker.stopRequested = false;
  }
}

function stopCheckerLoop() {
  checker.stopRequested = true;
  log("STOP", "Stop solicitado por usuario");
}

function toggleAutoGenerate() {
  if (autoGenerator.active) {
    // Detener auto-generación
    if (autoGenerator.intervalId) {
      clearInterval(autoGenerator.intervalId);
      autoGenerator.intervalId = null;
    }
    autoGenerator.active = false;
    autoGenerator.nextRunTime = null;
    
    const btn = document.getElementById("autoGenBtn");
    const status = document.getElementById("autoGenStatus");
    if (btn) {
      btn.textContent = "Iniciar Auto-Gen";
      btn.classList.remove("btn-stop");
      btn.classList.add("btn-start");
    }
    if (status) {
      status.textContent = "Auto-generacion detenida";
      status.style.opacity = "0.7";
    }
    log("AUTO-GEN", "Auto-generacion detenida por usuario");
  } else {
    // Iniciar auto-generación
    const intervalMin = Math.max(1, Number(document.getElementById("autoGenIntervalMin")?.value || 5));
    const intervalMs = intervalMin * 60 * 1000;
    
    autoGenerator.active = true;
    autoGenerator.nextRunTime = Date.now() + intervalMs;
    
    // Primera generación inmediata
    runLab({ fast: false, disableButtons: false });
    log("AUTO-GEN", `Primera cookie generada. Siguiente en ${intervalMin} min`);
    
    // Configurar intervalo
    autoGenerator.intervalId = setInterval(() => {
      if (autoGenerator.active && !isGenerating) {
        runLab({ fast: false, disableButtons: false });
        autoGenerator.nextRunTime = Date.now() + intervalMs;
        log("AUTO-GEN", `Cookie generada automaticamente. Siguiente en ${intervalMin} min`);
      }
    }, intervalMs);
    
    const btn = document.getElementById("autoGenBtn");
    const status = document.getElementById("autoGenStatus");
    if (btn) {
      btn.textContent = "Detener Auto-Gen";
      btn.classList.remove("btn-start");
      btn.classList.add("btn-stop");
    }
    if (status) {
      status.textContent = `Auto-generando cada ${intervalMin} min`;
      status.style.opacity = "1";
      status.style.color = "#4ade80";
    }
    
    log("AUTO-GEN", `Auto-generacion iniciada: cada ${intervalMin} minutos`);
  }
}

function analyzeSampleCookie() {
  const sampleEl = document.getElementById("sampleCookie");
  const resultEl = document.getElementById("profileResult");
  if (!sampleEl || !resultEl) return;

  const parsed = parseCookiePairs(sampleEl.value || "");
  if (!parsed || Object.keys(parsed).length === 0) {
    resultEl.textContent = "No se pudo analizar la muestra. Formato esperado: key=value; key=value";
    return;
  }

  const keys = Object.keys(parsed);
  
  // Detectar si es formato Amazon
  const amazonKeys = ["ubid-main", "session-token", "i18n-prefs", "csm-hit", "session-id-time", 
                       "id_pk", "id_pkel", "lc-main", "rxc", "session-id", "skin"];
  const hasAmazonKeys = amazonKeys.filter(k => k in parsed);
  const isAmazonFormat = hasAmazonKeys.length >= 8; // Al menos 8 de 11 claves

  const profile = {
    keys_detected: keys.length,
    format_detected: isAmazonFormat ? "Amazon-like" : "Generic Cookie",
    keys,
    lengths: keys.reduce((acc, key) => {
      acc[key] = String(parsed[key]).length;
      return acc;
    }, {})
  };

  // Si es formato Amazon, validar estructura
  if (isAmazonFormat) {
    const validation = {
      valid: true,
      issues: []
    };

    // Validar ubid-main
    if (parsed["ubid-main"] && !/^\d{3}-\d{7}-\d{7}$/.test(parsed["ubid-main"])) {
      validation.valid = false;
      validation.issues.push("ubid-main: formato incorrecto (esperado: XXX-XXXXXXX-XXXXXXX)");
    }

    // Validar session-id
    if (parsed["session-id"] && !/^\d{3}-\d{7}-\d{7}$/.test(parsed["session-id"])) {
      validation.valid = false;
      validation.issues.push("session-id: formato incorrecto (esperado: XXX-XXXXXXX-XXXXXXX)");
    }

    // Validar session-id-time
    if (parsed["session-id-time"] && !parsed["session-id-time"].endsWith("l")) {
      validation.valid = false;
      validation.issues.push("session-id-time: debe terminar en 'l'");
    }

    // Validar csm-hit
    if (parsed["csm-hit"] && !parsed["csm-hit"].startsWith("tb:")) {
      validation.valid = false;
      validation.issues.push("csm-hit: debe empezar con 'tb:'");
    }

    // Validar campos fijos
    if (parsed["id_pk"] && parsed["id_pk"] !== "eyJuIjoiMSJ9") {
      validation.valid = false;
      validation.issues.push("id_pk: valor incorrecto (esperado: eyJuIjoiMSJ9)");
    }

    if (parsed["id_pkel"] && parsed["id_pkel"] !== "n1") {
      validation.valid = false;
      validation.issues.push("id_pkel: valor incorrecto (esperado: n1)");
    }

    if (parsed["skin"] && parsed["skin"] !== "noskin") {
      validation.valid = false;
      validation.issues.push("skin: valor incorrecto (esperado: noskin)");
    }

    profile.amazon_validation = validation.valid ? "✓ VALIDA" : "✗ INVALIDA";
    if (validation.issues.length > 0) {
      profile.validation_issues = validation.issues;
    }
  }

  resultEl.textContent = JSON.stringify(profile, null, 2);
}

function clearSampleProfile() {
  const sampleEl = document.getElementById("sampleCookie");
  const resultEl = document.getElementById("profileResult");
  if (sampleEl) sampleEl.value = "";
  if (resultEl) resultEl.textContent = "";
}

function updateAmazonModeNotice() {
  // Función deshabilitada - selector eliminado
  return;
}

function isTermsAccepted() {
  return true; // Siempre true - checkbox de términos eliminado
}

function updateTermsIndicator() {
  // Función deshabilitada - checkbox de términos eliminado
  return;
}

function setFlowMode(mode) {
  flowMode = mode === "gate-auth" ? "gate-auth" : "amazon-cookies";

  const amazonBtn = document.getElementById("flowAmazonBtn");
  const gateBtn = document.getElementById("flowGateBtn");
  const publicGateSelect = document.getElementById("publicGateSelect");
  const copyBtn = document.getElementById("copyCookieBtn");
  const cloneNotice = document.getElementById("clonePolicyNotice");
  const contentSection = document.querySelector(".content");

  if (amazonBtn) amazonBtn.classList.toggle("active", flowMode === "amazon-cookies");
  if (gateBtn) gateBtn.classList.toggle("active", flowMode === "gate-auth");

  if (publicGateSelect) {
    publicGateSelect.disabled = flowMode !== "gate-auth";
    if (flowMode === "amazon-cookies") {
      publicGateSelect.value = "amazon";
      selectGate("amazon");
    } else if (["amazon", "paypal", "fwgates"].includes(publicGateSelect.value)) {
      selectGate(publicGateSelect.value);
    }
  } else if (flowMode === "amazon-cookies" && selectedGate !== "amazon") {
    // Si el selector publico no existe, igual forzamos Amazon para evitar mezcla de modos.
    selectGate("amazon");
  }

  const flowNodes = document.querySelectorAll("[data-flow]");
  flowNodes.forEach((node) => {
    const declared = String(node.getAttribute("data-flow") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const visible = declared.length ? declared.includes(flowMode) : true;
    node.classList.toggle("flow-hidden", !visible);
  });

  if (copyBtn) {
    copyBtn.disabled = flowMode === "amazon-cookies";
    copyBtn.style.opacity = flowMode === "amazon-cookies" ? "0.65" : "1";
  }

  if (cloneNotice) {
    cloneNotice.textContent =
      flowMode === "amazon-cookies"
        ? "Modo Amazon Cookies: clonado/copia deshabilitado por politica."
        : "Clonado permitido segun modo Gate Auth.";
  }

  if (contentSection) {
    contentSection.classList.toggle("gate-layout", flowMode === "gate-auth");
  }

  localStorage.setItem(FLOW_KEY, flowMode);
  updateAmazonModeNotice();
}

async function connectGateApi() {
  const status = await apiRequest("/api/health", { method: "GET" });
  if (!status.ok || !status.data?.ok) {
    setStatus("Gate API no disponible. Revisa API base/backups.", "running");
    log("API", "Gate API offline o sin respuesta valida");
    return false;
  }

  setStatus(`Gate API conectada: ${status.base}`, "done");
  log("API", `Gate API activa en ${status.base}`);
  return true;
}

function initFlowMode() {
  const saved = localStorage.getItem(FLOW_KEY);
  setFlowMode(saved === "gate-auth" ? "gate-auth" : "amazon-cookies");

  const publicGateSelect = document.getElementById("publicGateSelect");
  if (publicGateSelect) {
    publicGateSelect.addEventListener("change", () => {
      if (flowMode === "gate-auth") {
        selectGate(publicGateSelect.value || "amazon");
      }
    });
  }
}

function hasAdminViewAccess() {
  return Boolean(ownerSession.owner_token && ownerSession.access_key);
}

function syncRoleViewAccess() {
  const adminBtn = document.getElementById("viewAdminBtn");
  const canAccess = hasAdminViewAccess();

  if (adminBtn) {
    adminBtn.disabled = !canAccess;
    adminBtn.style.opacity = canAccess ? "1" : "0.55";
    adminBtn.style.cursor = canAccess ? "pointer" : "not-allowed";
    adminBtn.title = canAccess
      ? "Vista Admin habilitada"
      : "Requiere Owner Login + Generate Key";
  }

  const current = localStorage.getItem(VIEW_KEY);
  if (!canAccess && current === "admin") {
    setRoleView("user");
  }
}

function setRoleView(view) {
  const wantsAdmin = view === "admin";
  const role = wantsAdmin && hasAdminViewAccess() ? "admin" : "user";
  const userBtn = document.getElementById("viewUserBtn");
  const adminBtn = document.getElementById("viewAdminBtn");
  const roleChip = document.getElementById("roleChip");

  if (userBtn) userBtn.classList.toggle("active", role === "user");
  if (adminBtn) adminBtn.classList.toggle("active", role === "admin");
  if (roleChip) roleChip.textContent = `VIEW: ${role.toUpperCase()}`;

  const roleNodes = document.querySelectorAll("[data-role]");
  roleNodes.forEach((node) => {
    const declared = String(node.getAttribute("data-role") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const visible = declared.length ? declared.includes(role) : true;
    node.classList.toggle("role-hidden", !visible);
  });

  localStorage.setItem(VIEW_KEY, role);

  if (wantsAdmin && role !== "admin") {
    setStatus("Vista Admin bloqueada. Inicia Owner Login y genera Access Key.", "running");
  }
}

function initRoleView() {
  syncRoleViewAccess();
  const saved = localStorage.getItem(VIEW_KEY);
  if (saved === "admin" && !hasAdminViewAccess()) {
    setRoleView("user");
    return;
  }
  setRoleView(saved === "admin" ? "admin" : "user");
}

updateStatsUI();

initFlowMode();
initRoleView();
loadImports();
initQuick();
initTabs();
updateAmazonModeNotice();
// Términos y amazonCookieSource selector eliminados
updGate();
updApi(preferredApiBase, false);
loadApiBackupsFromStorage();
toggleCtrl(false);
showQueue();
log("INIT", "Checker dashboard listo");
window.runLab = runLab;
window.refreshSession = refreshSession;
window.unlinkSource = unlinkSource;
window.clearLab = clearLab;
window.updateSelectedFormat = updateSelectedFormat;
window.copyFormattedCookie = copyFormattedCookie;
window.runWalletAssociationTest = runWalletAssociationTest;
window.analyzeSampleCookie = analyzeSampleCookie;
window.clearSampleProfile = clearSampleProfile;
window.ownerLogin = ownerLogin;
window.generateOwnerAccessKey = generateOwnerAccessKey;
window.selectGate = selectGate;
window.saveApiBackups = saveApiBackups;
window.testApiBackups = testApiBackups;
window.loadStripeConfigFromApi = loadStripeConfigFromApi;
window.initStripeAuth = initStripeAuth;
window.runStripeAuth = runStripeAuth;
window.initBraintreeAuth = initBraintreeAuth;
window.runBraintreeAuth = runBraintreeAuth;
window.startCheckerLoop = startCheckerLoop;
window.stopCheckerLoop = stopCheckerLoop;
window.runSingleCycle = runSingleCycle;
window.runBatchNow = runBatchNow;
window.applyGatePreset = applyGatePreset;
window.clearLiveLogs = clearLogs;
window.setRoleView = setRoleView;
window.setFlowMode = setFlowMode;
window.connectGateApi = connectGateApi;
window.generateDemoCardsLite = generateDemoCardsLite;
window.clearDemoCardsLite = clearDemoCardsLite;
window.generateDemoCardsAmazon = generateDemoCardsAmazon;
window.clearDemoCardsAmazon = clearDemoCardsAmazon;
window.toggleAutoGenerate = toggleAutoGenerate;
window.loadPastedCookie = loadPastedCookie;
window.startCardValidation = startCardValidation;
