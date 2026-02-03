//********************************************************************
//
// App Store Review Configuration
//
// Contains test account credentials for Apple App Store review process.
// The demo phone number bypasses Cognito authentication and returns
// mock tokens for testing purposes.
//
// SECURITY:
// 1. Set ENABLE_DEMO_ACCOUNT=true only during App Store review
// 2. Set DEMO_VERIFICATION_CODE to a 6-digit code (used directly, no prefix)
// 3. Disable after review by removing ENABLE_DEMO_ACCOUNT or setting to false
//
//*******************************************************************

export type DemoAccount = {
  uid: string;
  phoneE164: string;
  phoneDisplay: string;
  label: string;
};

// All demo/reviewer accounts (sandbox-only)
const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    uid: "demo-reviewer-uid-appstore",
    phoneE164: "+15550123456",
    phoneDisplay: "(555) 012-3456",
    label: "Reviewer (primary)",
  },
  {
    uid: "demo-scenario-01",
    phoneE164: "+15550123457",
    phoneDisplay: "(555) 012-3457",
    label: "Scenario 1",
  },
  {
    uid: "demo-scenario-02",
    phoneE164: "+15550123458",
    phoneDisplay: "(555) 012-3458",
    label: "Scenario 2",
  },
  {
    uid: "demo-scenario-03",
    phoneE164: "+15550123459",
    phoneDisplay: "(555) 012-3459",
    label: "Scenario 3",
  },
  {
    uid: "demo-scenario-04",
    phoneE164: "+15550123460",
    phoneDisplay: "(555) 012-3460",
    label: "Scenario 4",
  },
  {
    uid: "demo-scenario-05",
    phoneE164: "+15550123461",
    phoneDisplay: "(555) 012-3461",
    label: "Scenario 5",
  },
  {
    uid: "demo-scenario-06",
    phoneE164: "+15550123462",
    phoneDisplay: "(555) 012-3462",
    label: "Scenario 6",
  },
  {
    uid: "demo-scenario-07",
    phoneE164: "+15550123463",
    phoneDisplay: "(555) 012-3463",
    label: "Scenario 7",
  },
];

// Backwards compatibility with existing imports
export const DEMO_PHONE_NUMBER = DEMO_ACCOUNTS[0].phoneE164;
export const DEMO_USER_UID = DEMO_ACCOUNTS[0].uid;

// Demo school email for testing email verification
// Uses a real allowed domain so it passes domain validation
export const DEMO_SCHOOL_EMAIL = "reviewer@missouristate.edu";

// Get the 6-digit verification code from environment (required for demo to work)
function getDemoCode(): string | null {
  return process.env.DEMO_VERIFICATION_CODE || "123456";
}

export function getDemoVerificationCode(): string | null {
  return getDemoCode();
}

// Check if demo account feature is enabled
export function isDemoAccountEnabled(): boolean {
  return process.env.ENABLE_DEMO_ACCOUNT === "true" && getDemoCode() !== null;
}

// Check if a phone number is the demo account
export function isDemoPhoneNumber(phoneE164: string): boolean {
  return Boolean(getDemoAccountByPhone(phoneE164));
}

// Check if an email is the demo email
export function isDemoEmail(email: string): boolean {
  return isDemoAccountEnabled() && email.toLowerCase() === DEMO_SCHOOL_EMAIL;
}

export function getDemoAccounts(): DemoAccount[] {
  return isDemoAccountEnabled() ? DEMO_ACCOUNTS : [];
}

// Raw list for isolation logic (does not depend on env flag)
export function getDemoAccountsAlways(): DemoAccount[] {
  return DEMO_ACCOUNTS;
}

export function getDemoAccountByPhone(phoneE164: string): DemoAccount | null {
  if (!isDemoAccountEnabled()) return null;
  return DEMO_ACCOUNTS.find((a) => a.phoneE164 === phoneE164.trim()) ?? null;
}

export function getDemoAccountByUid(uid: string): DemoAccount | null {
  if (!isDemoAccountEnabled()) return null;
  return DEMO_ACCOUNTS.find((a) => a.uid === uid) ?? null;
}

export function getDemoUids(): string[] {
  return getDemoAccounts().map((a) => a.uid);
}

export function isDemoUid(uid: string): boolean {
  return Boolean(getDemoAccountByUid(uid));
}

export function getAllDemoUids(): string[] {
  return getDemoAccountsAlways().map((a) => a.uid);
}

export function isDemoUidStatic(uid: string): boolean {
  return getDemoAccountsAlways().some((a) => a.uid === uid);
}

// Check if the code matches demo verification code (SECRET-123456 format)
export function isDemoVerificationCode(code: string): boolean {
  const expectedCode = getDemoVerificationCode();
  if (!expectedCode) return false;
  return code.trim() === expectedCode.trim();
}
