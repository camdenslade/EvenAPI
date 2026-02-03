//********************************************************************
//
// Array Normalization Utility
//
// Normalizes array fields to prevent Postgres "malformed array literal"
// errors when frontend sends strings instead of arrays. Ensures all
// array columns receive valid array values.
//
// Return Value
// ------------
// T[]    Normalized array (never throws)
//
// Value Parameters
// ----------------
// value    T | T[] | null | undefined    Value to normalize
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
 * Normalizes a value to an array. Handles cases where frontend sends
 * strings (e.g., "6'5\"") instead of arrays. Postgres array columns
 * require proper array literals to prevent "malformed array literal" errors.
 *
 * - If value is already an array → returns it as-is
 * - If value is a string → wraps it in an array
 * - If value is null/undefined → returns empty array
 * - Never throws, always returns a valid array
 */
export function normalizeArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  // Handle string or other primitive types by wrapping in array
  return [value];
}
