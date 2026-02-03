import { sanitizeForLogging } from "./log-sanitizer";

export class CarrierLookupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarrierLookupConfigError";
  }
}

export class CarrierLookupRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarrierLookupRequestError";
  }
}

type CarrierLookupResult = {
  name: string | null;
  type: string | null;
  errorCode: string | number | null;
};

const ALLOWED_CARRIER_KEYWORDS: ReadonlyArray<string> = [
  "verizon",
  "t mobile",
  "tmobile",
  "at t",
  "at and t",
  "att",
  "atandt",
  "google fi",
  "googlefi",
  "mint",
  "visible",
  "cricket",
  "us mobile",
  "usmobile",
  "boost",
  "dish",
];

const CARRIER_LOOKUP_TIMEOUT_MS = 4000;

function normalizeCarrierName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isAllowedCarrierName(name: string | null | undefined): boolean {
  if (!name) {
    return false;
  }

  const normalized = normalizeCarrierName(name);
  return ALLOWED_CARRIER_KEYWORDS.some((keyword) =>
    normalized.includes(normalizeCarrierName(keyword)),
  );
}

export async function lookupCarrier(
  phoneE164: string,
): Promise<CarrierLookupResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new CarrierLookupConfigError("Twilio lookup credentials are missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CARRIER_LOOKUP_TIMEOUT_MS,
  );

  try {
    const url = `https://lookups.twilio.com/v1/PhoneNumbers/${encodeURIComponent(
      phoneE164,
    )}?Type=carrier`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new CarrierLookupRequestError(
        `Twilio lookup failed (${response.status}): ${sanitizeForLogging(
          details,
        )}`,
      );
    }

    const data = (await response.json()) as {
      carrier?: {
        name?: string | null;
        type?: string | null;
        error_code?: string | number | null;
      } | null;
    };

    return {
      name: data.carrier?.name ?? null,
      type: data.carrier?.type ?? null,
      errorCode: data.carrier?.error_code ?? null,
    };
  } catch (err) {
    if (err instanceof CarrierLookupConfigError) {
      throw err;
    }
    throw new CarrierLookupRequestError(
      err instanceof Error ? err.message : "Carrier lookup request failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}
