import { rand } from "./utils.js";

export function generateCookies(profile, wallet, source, extras = {}) {
  return {
    locale: profile.locale,
    pref_currency: profile.currency,
    region: profile.region,
    country: profile.country,
    profile_id: profile.profile_id,
    account_id: `account_${rand(8)}`,
    user_id: `user_${rand(8)}`,
    device_id: `device_${rand(10)}`,
    checkout_id: `checkout_${rand(10)}`,
    wallet_id: wallet.wallet_id,
    wallet_state: wallet.wallet_state,
    wallet_card: extras.savedCard?.wallet_card ?? `${wallet.wallet_id}:${extras.paymentMethod?.payment_method_id ?? "na"}`,
    source_id: source.source_id,
    method_id: source.method_id ?? source.source_id,
    source_state: source.source_state,
    payment_method_id: extras.paymentMethod?.payment_method_id,
    payment_method: extras.paymentMethod?.payment_method,
    billing_id: extras.billingAddress?.billing_id,
    billing_address: extras.billingAddress,
    transaction_id: `transaction_${rand(12)}`,
    charge_id: `charge_${rand(10)}`,
    session_id: `session_${rand(12)}`,
    auth_token: `auth_${rand(20)}`,
    last_seen: Date.now(),
    metrics: `metrics_${rand(6)}`
  };
}

export function cookieString(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
