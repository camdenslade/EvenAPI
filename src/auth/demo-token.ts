import { UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

export type DemoTokenPayload = {
  sub: string;
  phone_number: string;
  token_use: "access";
  iat: number;
  exp: number;
};

function getDemoTokenSecret(): string {
  const secret = process.env.DEMO_AUTH_SECRET?.trim();
  if (!secret) {
    throw new UnauthorizedException("Demo auth is not configured");
  }
  return secret;
}

function signPayloadSegment(payloadSegment: string): string {
  return createHmac("sha256", getDemoTokenSecret())
    .update(payloadSegment)
    .digest("base64url");
}

export function createDemoAccessToken(payload: DemoTokenPayload): string {
  const payloadSegment = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `demo.${payloadSegment}.${signPayloadSegment(payloadSegment)}`;
}

export function verifyDemoAccessToken(token: string): DemoTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "demo") {
    throw new UnauthorizedException("Invalid demo token");
  }

  const payloadSegment = parts[1];
  const signature = parts[2];
  const expected = signPayloadSegment(payloadSegment);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new UnauthorizedException("Invalid demo token signature");
  }

  let payload: DemoTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    ) as DemoTokenPayload;
  } catch {
    throw new UnauthorizedException("Invalid demo token format");
  }

  if (
    !payload.sub ||
    !payload.phone_number ||
    payload.token_use !== "access" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new UnauthorizedException("Invalid demo token payload");
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException("Demo token expired");
  }

  return payload;
}
