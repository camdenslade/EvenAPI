//********************************************************************
//
// Carrier Lock Configuration
//
// Provides a single toggle to disable carrier allowlist enforcement.
// When disabled, any phone carrier is accepted during phone auth.
//
//*******************************************************************

export function isCarrierLockDisabled(): boolean {
  return process.env.DISABLE_CARRIER_LOCK === "true";
}
