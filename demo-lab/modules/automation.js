import { createProfile } from "./region.js";
import { createWallet, activateWallet } from "./wallet.js";
import { createDemoSource, linkSource } from "./source.js";
import { generateCookies } from "./cookies.js";
import {
  createBillingAddress,
  addCard,
  addPaymentMethod,
  listPaymentMethods,
  saveCard
} from "./payments.js";

export function runAutomation(regionKey) {
  const history = [];

  history.push("Seleccionar region");
  const profile = createProfile(regionKey);

  history.push("Billing address");
  const billingAddress = createBillingAddress(profile);

  history.push("Add card");
  const card = addCard();

  history.push("Add payment method");
  const paymentMethod = addPaymentMethod(card, billingAddress);

  history.push("Crear perfil");
  let wallet = createWallet();

  history.push("Payment methods");
  const paymentMethods = listPaymentMethods(wallet, paymentMethod);

  history.push("Crear wallet");
  let source = createDemoSource();

  history.push("Crear source");
  source = linkSource(source);

  history.push("Vincular source");
  wallet = activateWallet(wallet);

  history.push("Save card");
  const savedCard = saveCard(wallet, paymentMethod);

  history.push("Generar cookies");
  const cookies = generateCookies(profile, wallet, source, {
    billingAddress,
    paymentMethod,
    savedCard
  });

  history.push("Automatizacion de eventos");
  const score = computeScore(regionKey, cookies);
  const status = score >= 65 ? "Aprobado" : "Rechazado";

  history.push("Historial de cambios");
  history.push(`Estado final: ${status}`);

  return {
    profile,
    billingAddress,
    card,
    paymentMethod,
    paymentMethods,
    savedCard,
    wallet,
    source,
    cookies,
    history,
    score,
    status
  };
}

function computeScore(regionKey, cookies) {
  const baseByRegion = {
    MX: 72,
    US: 76,
    ES: 74,
    IT: 71,
    CA: 75
  };

  const base = baseByRegion[regionKey] ?? 70;
  const entropyBonus = (cookies.auth_token.length + cookies.session_id.length) % 7;
  return Math.min(99, base + entropyBonus);
}
