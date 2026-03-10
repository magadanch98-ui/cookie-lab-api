import { rand } from "./utils.js";

export function createWallet() {
  return {
    wallet_id: `wallet_${rand(8)}`,
    wallet_alias: "Lab Wallet",
    wallet_state: "wallet_created"
  };
}

export function activateWallet(wallet) {
  return {
    ...wallet,
    wallet_state: "wallet_active"
  };
}
