import { runAutomation } from "./modules/automation.js";
import { cookieString } from "./modules/cookies.js";

const regionEl = document.getElementById("region");
const runBtn = document.getElementById("runLabBtn");
const profileEl = document.getElementById("profilePanel");
const billingEl = document.getElementById("billingPanel");
const cardEl = document.getElementById("cardPanel");
const paymentMethodEl = document.getElementById("paymentMethodPanel");
const paymentMethodsEl = document.getElementById("paymentMethodsPanel");
const savedCardEl = document.getElementById("savedCardPanel");
const walletEl = document.getElementById("walletPanel");
const sourceEl = document.getElementById("sourcePanel");
const cookiesEl = document.getElementById("cookiesPanel");
const sessionEl = document.getElementById("sessionPanel");
const historyEl = document.getElementById("historyPanel");
const stateEl = document.getElementById("state");
const cookieRawEl = document.getElementById("cookiesRaw");
const bridgeBadgeEl = document.getElementById("bridgeBadge");
const BRIDGE_KEY = "eliteLabBridgeV1";
const initialBridge = rdBridge();

if (initialBridge?.region && hasRegionOption(initialBridge.region)) {
  regionEl.value = initialBridge.region;
}

updBadge(initialBridge);

runBtn.addEventListener("click", runLab);

if (initialBridge?.cards?.length || initialBridge?.address) {
  runLab();
}

function runLab() {
  const regionKey = regionEl.value;
  const result = runAutomation(regionKey);
  const bridge = rdBridge();
  updBadge(bridge);
  if (bridge) {
    useBridge(result, bridge);
  }

  profileEl.textContent = pretty(result.profile);
  billingEl.textContent = pretty(result.billingAddress);
  cardEl.textContent = pretty(result.card);
  paymentMethodEl.textContent = pretty(result.paymentMethod);
  paymentMethodsEl.textContent = pretty(result.paymentMethods);
  savedCardEl.textContent = pretty(result.savedCard);
  walletEl.textContent = pretty(result.wallet);
  sourceEl.textContent = pretty(result.source);
  cookiesEl.textContent = pretty(result.cookies);
  sessionEl.textContent = [
    `session_id: ${result.cookies.session_id}`,
    `auth_token: ${result.cookies.auth_token}`,
    `score: ${result.score}`,
    `resultado: ${result.status}`
  ].join("\n");

  historyEl.innerHTML = result.history
    .map((step, idx) => `<li><span>${idx + 1}.</span> ${step}</li>`)
    .join("");

  stateEl.textContent = pretty(result);
  cookieRawEl.textContent = cookieString(result.cookies);
  stateEl.dataset.status = result.status.toLowerCase();
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function hasRegionOption(region) {
  return Array.from(regionEl.options).some((opt) => opt.value === region);
}

function rdBridge() {
  try {
    return JSON.parse(localStorage.getItem(BRIDGE_KEY) || "null");
  } catch (_) {
    return null;
  }
}

function updBadge(bridge) {
  if (!bridgeBadgeEl) return;
  const hasImported = Boolean(bridge?.cards?.length || bridge?.address);
  bridgeBadgeEl.classList.toggle("imported", hasImported);
  bridgeBadgeEl.textContent = hasImported ? "BRIDGE: IMPORTED" : "BRIDGE: --";
}

function parseCard(raw) {
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split("|").map((s) => s.trim());
  if (parts.length < 4) return null;
  const [cardNumber, expMonth, expYear, cvv] = parts;
  if (!/^\d{13,19}$/.test(cardNumber)) return null;
  if (!/^\d{2}$/.test(expMonth) || !/^\d{4}$/.test(expYear)) return null;
  if (!/^\d{3,4}$/.test(cvv)) return null;
  return { cardNumber, expMonth, expYear, cvv };
}

function detectBrand(cardNumber) {
  if (/^4/.test(cardNumber)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6][0-9]|7[01]|720))/.test(cardNumber)) return "mastercard";
  if (/^3[47]/.test(cardNumber)) return "amex";
  if (/^(6011|65|64[4-9]|622)/.test(cardNumber)) return "discover";
  return "unknown";
}

function useBridge(result, bridge) {
  const importedCard = parseCard(Array.isArray(bridge.cards) ? bridge.cards[0] : null);
  if (importedCard) {
    const expiry = `${importedCard.expMonth}/${importedCard.expYear}`;
    result.card = {
      ...result.card,
      brand: detectBrand(importedCard.cardNumber),
      card_number: importedCard.cardNumber,
      cardNumber: importedCard.cardNumber,
      expiry_date: expiry,
      exp: expiry,
      exp_month: importedCard.expMonth,
      exp_year: importedCard.expYear,
      security_code: importedCard.cvv,
      cvv: importedCard.cvv,
      last4: importedCard.cardNumber.slice(-4),
      imported: true
    };

    if (result.paymentMethod?.card_details) {
      result.paymentMethod.card_details.card_number = importedCard.cardNumber;
      result.paymentMethod.card_details.expiration_date = expiry;
      result.paymentMethod.card_details.security_code = importedCard.cvv;
    }
  }

  if (bridge.address) {
    result.billingAddress = {
      ...result.billingAddress,
      line_1: bridge.address,
      imported: true
    };

    if (result.paymentMethod?.billing_address) {
      result.paymentMethod.billing_address.line_1 = bridge.address;
    }
  }

  if (importedCard || bridge.address) {
    result.history.unshift("Bridge: datos importados desde Landing");
  }
}
