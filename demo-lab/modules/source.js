import { rand } from "./utils.js";

export function createDemoSource() {
  const methodId = `method_${rand(10)}`;
  return {
    source_id: methodId,
    method_id: methodId,
    source_type: "credential_demo",
    source_state: "payment_method",
    validation_state: "verification_pending",
    verification_id: `verification_${rand(8)}`,
    verification_state: "verification_pending"
  };
}

export function linkSource(source) {
  return {
    ...source,
    source_state: "source_linked",
    validation_state: "verification_passed",
    verification_state: "verification_passed"
  };
}
