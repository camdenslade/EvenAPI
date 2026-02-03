//********************************************************************
//
// SanitizeUtil
//
// Lightweight helpers to strip HTML/script content and validate basic
// user input for public forms.
//
//********************************************************************

export class SanitizeUtil {
  static sanitizeInput(input: string): string {
    if (!input) return "";
    let sanitized = input.replace(/<[^>]*>/g, "");
    sanitized = sanitized.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      "",
    );
    sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");
    return sanitized.trim();
  }

  static containsSpamPatterns(text: string): boolean {
    if (!text) return false;
    const patterns = [
      /(http|https):\/\/[^\s]+/gi,
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      /(.)\1{10,}/g,
      /(buy|sell|cheap|free|click here)/gi,
    ];
    return patterns.some((p) => p.test(text));
  }

  static isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  static isValidName(name: string): boolean {
    return /^[a-zA-Z\\s]{2,100}$/.test(name);
  }
}
