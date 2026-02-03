//********************************************************************
//
// Log Sanitizer Utility
//
// Recursively sanitizes sensitive data from logs and error messages.
// Removes PII, tokens, credentials, and other sensitive information
// before writing to logs or returning in error responses.
//
// Return Value
// ------------
// string    Sanitized string with sensitive data replaced
//
// Value Parameters
// ----------------
// data    any    Data to sanitize (string, object, or array)
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// None
//
//*******************************************************************

/**
 * Replacement strings for sensitive data
 */
const REPLACEMENTS = {
  phone: "[PHONE_REDACTED]",
  phoneHash: "[PHONE_HASH_REDACTED]",
  token: "[TOKEN_REDACTED]",
  credential: "[CREDENTIAL_REDACTED]",
  email: "[EMAIL_REDACTED]",
  password: "[PASSWORD_REDACTED]",
  default: "[REDACTED]",
};

/**
 * Sanitizes a string by replacing sensitive patterns
 */
function sanitizeString(str: string): string {
  let sanitized = str;

  // Replace phone numbers
  sanitized = sanitized.replace(
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b|\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    REPLACEMENTS.phone,
  );

  // Replace phone hashes (64-char hex)
  sanitized = sanitized.replace(/\b[a-f0-9]{64}\b/gi, REPLACEMENTS.phoneHash);

  // Replace JWT tokens
  sanitized = sanitized.replace(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    REPLACEMENTS.token,
  );

  // Replace AWS credentials
  sanitized = sanitized.replace(
    /\bAKIA[0-9A-Z]{16}\b/g,
    REPLACEMENTS.credential,
  );
  sanitized = sanitized.replace(/\b[A-Za-z0-9/+=]{40,}\b/g, (match) =>
    match.length >= 40 ? REPLACEMENTS.credential : match,
  );

  // Replace email addresses (keep domain for debugging)
  sanitized = sanitized.replace(
    /\b([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    `[EMAIL_REDACTED]@$2`,
  );

  // Replace password/token patterns
  sanitized = sanitized.replace(
    /(password|pwd|secret|token|api[_-]?key|access[_-]?token)["\s:=]+([^\s"',}]+)/gi,
    `$1=${REPLACEMENTS.password}`,
  );

  return sanitized;
}

/**
 * Recursively sanitizes data (string, object, or array)
 */
export function sanitizeForLogging(data: any): string {
  if (data === null || data === undefined) {
    return String(data);
  }

  if (typeof data === "string") {
    return sanitizeString(data);
  }

  if (typeof data === "number" || typeof data === "boolean") {
    return String(data);
  }

  if (data instanceof Error) {
    return sanitizeString(
      JSON.stringify({
        name: data.name,
        message: data.message,
        stack:
          process.env.NODE_ENV === "production"
            ? "[STACK_REDACTED]"
            : data.stack,
      }),
    );
  }

  if (Array.isArray(data)) {
    return JSON.stringify(data.map((item) => sanitizeForLogging(item)));
  }

  if (typeof data === "object") {
    const sanitized: Record<string, any> = {};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    for (const [key, value] of Object.entries(data)) {
      // Skip sensitive keys entirely
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("key") ||
        lowerKey.includes("phone") ||
        lowerKey.includes("email")
      ) {
        sanitized[key] = REPLACEMENTS.default;
      } else {
        // Recursively sanitize nested values
        const sanitizedValue = sanitizeForLogging(value);
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          sanitized[key] = JSON.parse(sanitizedValue);
        } catch {
          sanitized[key] = sanitizedValue;
        }
      }
    }
    return JSON.stringify(sanitized);
  }

  return REPLACEMENTS.default;
}
