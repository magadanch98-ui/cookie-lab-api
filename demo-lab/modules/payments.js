import { rand } from "./utils.js";

export function createBillingAddress(profile) {
  return {
    billing_id: `bill_${rand(8)}`,
    country: profile.country,
    region: profile.region,
    line_1: `Street ${rand(4)}`,
    city: `City_${profile.region.toUpperCase()}`,
    postal_code: String(Math.floor(10000 + Math.random() * 89999)),
    state: "active"
  };
}

export function addCard() {
  const brands = ["visa", "mastercard", "amex"];
  const brand = brands[Math.floor(Math.random() * brands.length)];
  const cardNumber = randomDigits(brand === "amex" ? 15 : 16);
  const expiryMonth = String(Math.floor(1 + Math.random() * 12)).padStart(2, "0");
  const expiryYear = String(2028 + Math.floor(Math.random() * 6));
  const securityCode = randomDigits(brand === "amex" ? 4 : 3);
  const last4 = cardNumber.slice(-4);
  return {
    card_id: `card_${rand(10)}`,
    brand,
    name_on_card: "LAB USER",
    card_number: cardNumber,
    cardNumber,
    masked_card: `•••• •••• •••• ${last4}`,
    expiry_date: `${expiryMonth}/${expiryYear}`,
    exp: `${expiryMonth}/${expiryYear}`,
    security_code: securityCode,
    cvv: securityCode,
    last4,
    exp_month: expiryMonth,
    exp_year: expiryYear,
    add_card: true,
    state: "card_added"
  };
}

export function addPaymentMethod(card, billingAddress) {
  return {
    payment_method_id: `pm_${rand(10)}`,
    payment_method: "card",
    payment_method_type: "card",
    card_id: card.card_id,
    card_number: card.card_number,
    card_details: {
      card_number: card.card_number,
      expiration_date: card.expiry_date,
      security_code: card.security_code,
      name_on_card: card.name_on_card
    },
    billing_address: {
      country: billingAddress.country,
      region: billingAddress.region,
      city: billingAddress.city,
      line_1: billingAddress.line_1,
      postal_code: billingAddress.postal_code
    },
    billing: billingAddress,
    billing_id: billingAddress.billing_id,
    state: "payment_method_added"
  };
}

export function listPaymentMethods(wallet, paymentMethod) {
  return {
    wallet_id: wallet.wallet_id,
    default_method: paymentMethod.payment_method_id,
    default_card: paymentMethod.card_id,
    total: 1,
    items: [paymentMethod]
  };
}

export function saveCard(wallet, paymentMethod) {
  return {
    save_id: `save_${rand(8)}`,
    wallet_id: wallet.wallet_id,
    payment_method_id: paymentMethod.payment_method_id,
    default_method: paymentMethod.payment_method_id,
    default_card: paymentMethod.card_id,
    wallet_card: `${wallet.wallet_id}:${paymentMethod.payment_method_id}`,
    state: "card_saved"
  };
}

function randomDigits(len) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 10);
  }
  return out;
}
