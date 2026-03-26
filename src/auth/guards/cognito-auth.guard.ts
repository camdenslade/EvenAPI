import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import {
  isDemoAccountEnabled,
  getDemoAccountByUid,
} from "../../constants/review-config";
import { verifyDemoAccessToken } from "../demo-token";

type CognitoSettings = {
  issuer: string;
  audiences: string[];
};

type CognitoAccessTokenClaims = {
  sub: string | null;
  email: string | null;
  phoneNumber: string | null;
  appleSub: string | null;
  tokenUse: string | null;
};

type JwksFetcher = (protectedHeader: { kid?: string }) => Promise<unknown>;

type JwtVerifyResult = {
  payload: Record<string, unknown>;
};

type JwtVerify = (
  token: string,
  key: JwksFetcher,
  options: { issuer: string; audience?: string | string[] },
) => Promise<JwtVerifyResult>;

type JoseModule = {
  createRemoteJWKSet: (url: URL) => JwksFetcher;
  jwtVerify: JwtVerify;
};

let joseModulePromise: Promise<JoseModule> | null = null;
const jwksCache = new Map<string, JwksFetcher>();

async function loadJose(): Promise<JoseModule> {
  if (!joseModulePromise) {
    joseModulePromise = import("jose").then((mod) => ({
      createRemoteJWKSet:
        mod.createRemoteJWKSet as JoseModule["createRemoteJWKSet"],
      jwtVerify: mod.jwtVerify as JoseModule["jwtVerify"],
    }));
  }
  return joseModulePromise;
}

function getCognitoSettings(): CognitoSettings {
  const region = process.env.AWS_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_APP_CLIENT_ID;
  if (!clientId) {
    throw new Error("COGNITO_APP_CLIENT_ID is not configured");
  }

  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const adminClientId = process.env.COGNITO_ADMIN_APP_CLIENT_ID?.trim();

  return {
    issuer,
    audiences: [clientId, ...(adminClientId ? [adminClientId] : [])],
  };
}

async function getJwks(issuer: string): Promise<JwksFetcher> {
  if (jwksCache.has(issuer)) {
    return jwksCache.get(issuer)!;
  }
  const { createRemoteJWKSet } = await loadJose();
  const set = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  jwksCache.set(issuer, set);
  return set;
}

function getStringClaim(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

export async function verifyCognitoAccessToken(
  token: string,
): Promise<CognitoAccessTokenClaims> {
  // Handle demo tokens for App Store review
  if (token.startsWith("demo.") && isDemoAccountEnabled()) {
    const payload = verifyDemoAccessToken(token);
    const demoAccount = getDemoAccountByUid(payload.sub);
    if (!demoAccount || payload.phone_number !== demoAccount.phoneE164) {
      throw new UnauthorizedException("Invalid demo token");
    }

    return {
      sub: demoAccount.uid,
      email: null,
      phoneNumber: payload.phone_number,
      appleSub: null,
      tokenUse: payload.token_use,
    };
  }

  const { issuer, audiences } = getCognitoSettings();
  try {
    const { jwtVerify } = await loadJose();
    const jwks = await getJwks(issuer);

    // Note: Cognito ACCESS tokens don't have an 'aud' claim - they have 'client_id' instead.
    // Only ID tokens have 'aud'. So we verify issuer here, then manually check client_id below.
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      // Don't pass audience here - access tokens use client_id, not aud
    });

    const tokenUse = getStringClaim(payload, "token_use");
    if (tokenUse && tokenUse !== "access") {
      throw new UnauthorizedException("Invalid token use");
    }

    // Verify client_id matches one of our expected app client IDs
    const clientId = getStringClaim(payload, "client_id");
    if (!clientId || !audiences.includes(clientId)) {
      throw new UnauthorizedException("Invalid client_id in access token");
    }

    return {
      sub: getStringClaim(payload, "sub"),
      email: getStringClaim(payload, "email"),
      phoneNumber: getStringClaim(payload, "phone_number"),
      appleSub: getStringClaim(payload, "apple_sub"),
      tokenUse,
    };
  } catch (err) {
    throw new UnauthorizedException(
      err instanceof Error ? err.message : "Invalid token",
    );
  }
}

@Injectable()
export class CognitoAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req: Request & { user?: any } = context.switchToHttp().getRequest();
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing authorization header");
    }

    const token = header.split(" ")[1];
    const payload = await verifyCognitoAccessToken(token);
    if (!payload.sub) {
      throw new UnauthorizedException("Missing subject in access token");
    }

    req.user = {
      uid: payload.sub,
      cognitoSub: payload.sub,
      email: payload.email,
      phone: payload.phoneNumber,
      appleSub: payload.appleSub,
    };

    return true;
  }
}
