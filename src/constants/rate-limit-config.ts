//********************************************************************
//
// Rate Limit Configuration
//
// Provides a single toggle to disable backend rate limiting logic.
//
//*******************************************************************

export function isAuthRateLimitDisabled(): boolean {
  return process.env.DISABLE_AUTH_RATE_LIMITS === "true";
}
