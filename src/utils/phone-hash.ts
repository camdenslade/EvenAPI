//********************************************************************
//
// Phone Hashing Utility
//
// Normalizes phone numbers to E.164 format and hashes them using
// SHA-256 with server-side salt. Used for SafetyIdentity to prevent
// phone number exposure while maintaining lookup capability.
//
// Return Value
// ------------
// string    Hashed phone number (hex string)
//
// Value Parameters
// ----------------
// phone    string    Phone number to hash
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// salt           string    Server-side salt from environment
// normalized     string    E.164 normalized phone number
// hash           string    SHA-256 hash result
//
//*******************************************************************

import { createHmac, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const ALLOWED_PHONE_LINE_TYPES = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"]);

const DUMMY_NATIONAL_SEQUENCES = new Set([
  "0123456789",
  "1234567890",
  "0987654321",
  "9876543210",
]);

function isLikelyDummyNumber(
  nationalNumber: string,
  country?: string,
): boolean {
  if (!nationalNumber) {
    return true;
  }

  if (/^(\d)\1+$/.test(nationalNumber)) {
    return true;
  }

  if (DUMMY_NATIONAL_SEQUENCES.has(nationalNumber)) {
    return true;
  }

  if (
    (country === "US" || country === "CA") &&
    /^\d{3}55501\d{2}$/.test(nationalNumber)
  ) {
    return true;
  }

  return false;
}

/**
 * Normalizes a phone number to E.164 format.
 *
 * @param phone - Phone number in any format
 * @returns E.164 formatted phone number (e.g., +1234567890)
 */
export function normalizePhoneToE164(phone: string): string {
  if (!phone) {
    throw new Error("Phone number is required");
  }

  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  // If no + prefix, assume US number and add +1
  // This is a simple fallback - in production, consider using libphonenumber-js
  if (cleaned.length === 10) {
    return "+1" + cleaned;
  }

  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return "+" + cleaned;
  }

  // If format is unclear, return as-is with + prefix
  return "+" + cleaned;
}

/**
 * Normalizes and validates a phone number for auth.
 * Ensures the number is valid, mobile-capable, and not a dummy sequence.
 */
export function normalizePhoneToE164Strict(phone: string): string {
  if (!phone) {
    throw new Error("Phone number is required");
  }

  const trimmed = phone.trim();
  const candidate = trimmed.startsWith("+")
    ? trimmed
    : normalizePhoneToE164(trimmed);
  const parsed = parsePhoneNumberFromString(candidate);

  if (!parsed || !parsed.isValid()) {
    throw new Error("Invalid phone number");
  }

  const lineType = parsed.getType();
  if (!lineType || !ALLOWED_PHONE_LINE_TYPES.has(lineType)) {
    throw new Error("Phone number must be a valid mobile number");
  }

  if (isLikelyDummyNumber(parsed.nationalNumber, parsed.country)) {
    throw new Error("Phone number is not allowed");
  }

  return parsed.number;
}

/**
 * Hashes a phone number using SHA-256 with server-side salt.
 *
 * @param phone - Phone number to hash
 * @returns Hashed phone number (hex string)
 * @throws Error if PHONE_HASH_SALT is not set
 */
export function hashPhone(phone: string): string {
  const pepper = process.env.PHONE_HASH_SALT;
  if (!pepper) {
    throw new Error(
      "PHONE_HASH_SALT environment variable is required for phone hashing",
    );
  }

  const normalized = normalizePhoneToE164(phone);

  // Use scrypt (KDF) with a per-hash random salt and a server-side pepper
  const salt = randomBytes(16);
  const derived = scryptSync(normalized + pepper, salt, 32);

  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Deterministic phone hash using HMAC-SHA256 and a server-side secret.
 * Produces stable output for the same normalized phone number.
 *
 * @param phone - Phone number to hash
 * @returns Hashed phone number (hex string)
 * @throws Error if PHONE_HASH_HMAC_SECRET is not set
 */
export function hashPhoneDeterministic(phone: string): string {
  const secret = process.env.PHONE_HASH_HMAC_SECRET;
  if (!secret) {
    throw new Error(
      "PHONE_HASH_HMAC_SECRET environment variable is required for deterministic phone hashing",
    );
  }

  const normalized = normalizePhoneToE164(phone);
  const hmac = createHmac("sha256", secret);
  hmac.update(normalized);
  return hmac.digest("hex");
}

/**
 * Verifies a phone number against a stored scrypt hash.
 *
 * @param phone - Phone number to verify
 * @param stored - Stored hash in format salt:hash (hex)
 * @returns boolean indicating match
 */
export function verifyPhoneHash(phone: string, stored: string): boolean {
  const pepper = process.env.PHONE_HASH_SALT;
  if (!pepper) {
    throw new Error(
      "PHONE_HASH_SALT environment variable is required for phone hash verification",
    );
  }

  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(normalizePhoneToE164(phone) + pepper, salt, 32);

  // Constant-time comparison
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
