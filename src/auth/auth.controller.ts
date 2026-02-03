//********************************************************************
//
// AuthController Class
//
// Authentication controller providing logout endpoint. Cognito handles
// token lifecycle; refresh is disabled server-side.
//
// Return Value
// ------------
// None (NestJS controller class)
//
// Value Parameters
// ----------------
// None
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
//
//
//*******************************************************************

import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Logger,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IsString, IsNotEmpty } from "class-validator";
import type { Request as ExpressRequest } from "express";
import { AuthUser } from "./auth-user.decorator";
import { Public } from "./decorators/public.decorator";
import { EmailService } from "../email/email.service";
import { UsersService } from "../users/users.service";
import { TokensService } from "../tokens/tokens.service";
import { RedisService } from "../redis/redis.service";
import { ProfilesService } from "../profiles/profiles.service";
import { MatchesService } from "../matches/matches.service";
import { BlocksService } from "../blocks/blocks.service";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  type InitiateAuthCommandOutput,
  type RespondToAuthChallengeCommandOutput,
} from "@aws-sdk/client-cognito-identity-provider";
import { createHmac } from "crypto";
import {
  hashPhoneDeterministic,
  normalizePhoneToE164Strict,
} from "../utils/phone-hash";
import {
  CarrierLookupConfigError,
  isAllowedCarrierName,
  lookupCarrier,
} from "../utils/phone-carrier";
import { sanitizeForLogging } from "../utils/log-sanitizer";
import { verifyCognitoAccessToken } from "./guards/cognito-auth.guard";
import {
  isDemoVerificationCode,
  getDemoAccountByPhone,
  getDemoAccountsAlways,
} from "../constants/review-config";

// DTO for strong typing and automatic validation
class RefreshSessionDto {
  @IsString()
  @IsNotEmpty()
  uid: string;
}

class UpdateEmailDto {
  @IsString()
  @IsNotEmpty()
  email: string;
}

class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}

class StartPhoneAuthDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;
}

class VerifyPhoneDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  session: string;
}

const ALLOWED_SCHOOL_DOMAINS = [
  "missouristate.edu",
  "drury.edu",
  "evangel.edu",
  "otc.edu",
  "mission.edu",
  "sbuniv.edu",
];

const PHONE_RATE_LIMITS = {
  start: { windowMs: 15 * 60 * 1000, max: 5 },
  resend: { windowMs: 15 * 60 * 1000, max: 5 },
  verify: { windowMs: 15 * 60 * 1000, max: 10 },
} as const;

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly cognito: CognitoIdentityProviderClient;
  private readonly cognitoClientId =
    process.env.COGNITO_APP_CLIENT_ID || "50aqk5vith0fjc6gb857tgjvv";
  private readonly cognitoClientSecret = process.env.COGNITO_APP_CLIENT_SECRET;
  private readonly challengeTtlMs = 5 * 60 * 1000; // 5 minutes
  private readonly maxAttemptsPerSession = 5;

  constructor(
    private readonly emailService: EmailService,
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
    private readonly redis: RedisService,
    private readonly profilesService: ProfilesService,
    private readonly matchesService: MatchesService,
    private readonly blocksService: BlocksService,
  ) {
    this.cognito = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }

  private findDemoFromRaw(raw: string) {
    const digits = raw.replace(/[^\d]/g, "");
    return getDemoAccountsAlways().find((a) => a.phoneE164.endsWith(digits));
  }

  private normalizePhoneInput(raw: string): string {
    const demoMatch = this.findDemoFromRaw(raw);
    if (demoMatch) {
      return demoMatch.phoneE164;
    }
    try {
      return normalizePhoneToE164Strict(raw);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Invalid phone number";
      this.logger.warn(
        `Invalid phone input: ${sanitizeForLogging(raw)} (${message})`,
      );
      throw new BadRequestException(message);
    }
  }

  private challengeMetaKey(session: string) {
    return `auth:challenge:${session}:meta`;
  }

  private challengeAttemptsKey(session: string) {
    return `auth:challenge:${session}:attempts`;
  }

  private async checkPhoneRateLimit(
    phoneE164: string,
    action: keyof typeof PHONE_RATE_LIMITS,
  ): Promise<void> {
    const config = PHONE_RATE_LIMITS[action];
    const phoneHash = hashPhoneDeterministic(phoneE164);
    const key = `auth:phone:${action}:${phoneHash}`;
    const ttlSeconds = Math.ceil(config.windowMs / 1000);

    const count = await this.redis.safe(() => this.redis.client.incr(key), {
      op: "incr",
      key,
    });

    if (count === 1) {
      await this.redis.safe(() => this.redis.client.expire(key, ttlSeconds), {
        op: "expire",
        key,
      });
    }

    if (count !== null && count > config.max) {
      throw new BadRequestException(
        "Too many verification attempts. Please try again later.",
      );
    }
  }

  private async assertAllowedCarrier(phoneE164: string): Promise<void> {
    if (process.env.PHONE_CARRIER_ALLOWLIST_DISABLED === "true") {
      return;
    }

    try {
      const carrier = await lookupCarrier(phoneE164);
      const carrierName = carrier.name?.trim() ?? "";
      const carrierType = carrier.type?.toLowerCase() ?? null;

      if (carrier.errorCode) {
        throw new BadRequestException("Phone carrier not supported");
      }

      if (!carrierName || !isAllowedCarrierName(carrierName)) {
        throw new BadRequestException("Phone carrier not supported");
      }

      if (carrierType && carrierType !== "mobile") {
        throw new BadRequestException("Phone carrier not supported");
      }
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }

      if (err instanceof CarrierLookupConfigError) {
        this.logger.error(
          `Carrier lookup config error for ${sanitizeForLogging(phoneE164)}`,
        );
        throw new InternalServerErrorException(
          "Phone carrier verification is not configured",
        );
      }

      const message =
        err instanceof Error ? err.message : "Carrier lookup failed";
      this.logger.warn(
        `Carrier lookup failed for ${sanitizeForLogging(phoneE164)}: ${message}`,
      );
      throw new ServiceUnavailableException(
        "Unable to verify phone carrier. Please try again later.",
      );
    }
  }

  /**
   * Persist challenge session state in Redis (single source of truth).
   * Stores phone and creation time with strict TTL; attempts live in a
   * dedicated counter key to allow atomic increments.
   */
  private async recordChallengeSession(session: string, phone: string) {
    const ttlSeconds = Math.ceil(this.challengeTtlMs / 1000);
    const meta = JSON.stringify({ phone, createdAt: Date.now() });

    await this.redis.client
      .multi()
      .set(this.challengeMetaKey(session), meta, { EX: ttlSeconds })
      .set(this.challengeAttemptsKey(session), "0", { EX: ttlSeconds })
      .exec();
  }

  /**
   * Loads challenge state from Redis and atomically increments attempts.
   * Enforces TTL, phone binding, and max-attempts across all nodes.
   */
  private async getChallengeSession(session: string, phone: string) {
    const metaRaw = await this.redis.client.get(this.challengeMetaKey(session));
    if (!metaRaw) {
      throw new UnauthorizedException("Challenge session expired");
    }

    let parsed: { phone: string; createdAt: number };
    try {
      parsed = JSON.parse(metaRaw) as { phone: string; createdAt: number };
    } catch {
      throw new UnauthorizedException("Challenge session expired");
    }

    if (parsed.phone !== phone) {
      throw new UnauthorizedException("Challenge session mismatch");
    }

    const attempts = await this.redis.client.incr(
      this.challengeAttemptsKey(session),
    );
    if (attempts === 1) {
      // Ensure the counter shares the same TTL as the meta key.
      const ttlSeconds = Math.ceil(this.challengeTtlMs / 1000);
      await this.redis.client.expire(
        this.challengeAttemptsKey(session),
        ttlSeconds,
      );
    }

    if (attempts > this.maxAttemptsPerSession) {
      throw new UnauthorizedException(
        "Too many attempts, please resend a code",
      );
    }

    return parsed;
  }

  private buildSecretHash(username: string): string {
    if (!this.cognitoClientSecret) {
      throw new InternalServerErrorException(
        "Cognito client secret not configured",
      );
    }
    return createHmac("sha256", this.cognitoClientSecret)
      .update(username + this.cognitoClientId)
      .digest("base64");
  }

  private async initiatePhoneChallenge(phoneE164: string) {
    try {
      const resp: InitiateAuthCommandOutput = await this.cognito.send(
        new InitiateAuthCommand({
          AuthFlow: "CUSTOM_AUTH",
          ClientId: this.cognitoClientId,
          AuthParameters: {
            USERNAME: phoneE164,
            SECRET_HASH: this.buildSecretHash(phoneE164),
          },
        }),
      );

      if (resp.ChallengeName !== "CUSTOM_CHALLENGE" || !resp.Session) {
        this.logger.warn(
          `Unexpected challenge state for ${phoneE164}: ${
            resp.ChallengeName ?? "none"
          }`,
        );
        throw new UnauthorizedException("Unable to start phone verification");
      }

      await this.recordChallengeSession(resp.Session, phoneE164);

      return {
        session: resp.Session,
        challenge: resp.ChallengeName,
        expiresInMs: this.challengeTtlMs,
      };
    } catch (err: unknown) {
      const errorCode =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : err instanceof Error
            ? err.name
            : undefined;
      const errorMessage = err instanceof Error ? err.message : undefined;
      const message =
        errorCode === "NotAuthorizedException"
          ? "Phone authentication not allowed"
          : (errorMessage ?? "Failed to start authentication");
      this.logger.error(
        `initiatePhoneChallenge failed: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new UnauthorizedException(message);
    }
  }

  @Public()
  @Post("phone/start")
  @HttpCode(HttpStatus.OK)
  async startPhoneAuth(@Body() body: StartPhoneAuthDto) {
    const phoneE164 = this.normalizePhoneInput(body.phoneNumber);

    // Demo account bypass - return fake session for App Store review
    const demoAccount = getDemoAccountByPhone(phoneE164);
    if (demoAccount) {
      this.logger.log(
        `Demo phone detected: ${phoneE164} (${demoAccount.label}) - returning mock session`,
      );
      const demoSession = `demo-session-${Date.now()}`;
      await this.recordChallengeSession(demoSession, phoneE164);
      return {
        session: demoSession,
        challenge: "CUSTOM_CHALLENGE",
        expiresInMs: this.challengeTtlMs,
      };
    }

    await this.checkPhoneRateLimit(phoneE164, "start");
    await this.assertAllowedCarrier(phoneE164);
    return this.initiatePhoneChallenge(phoneE164);
  }

  @Public()
  @Post("phone/resend")
  @HttpCode(HttpStatus.OK)
  async resendPhoneCode(@Body() body: StartPhoneAuthDto) {
    const phoneE164 = this.normalizePhoneInput(body.phoneNumber);

    // Demo account bypass - return fake session for App Store review
    const demoAccount = getDemoAccountByPhone(phoneE164);
    if (demoAccount) {
      this.logger.log(
        `Demo phone detected (resend): ${phoneE164} (${demoAccount.label}) - returning mock session`,
      );
      const demoSession = `demo-session-${Date.now()}`;
      await this.recordChallengeSession(demoSession, phoneE164);
      return {
        session: demoSession,
        challenge: "CUSTOM_CHALLENGE",
        expiresInMs: this.challengeTtlMs,
      };
    }

    await this.checkPhoneRateLimit(phoneE164, "resend");
    await this.assertAllowedCarrier(phoneE164);
    return this.initiatePhoneChallenge(phoneE164);
  }

  @Public()
  @Post("phone/verify")
  @HttpCode(HttpStatus.OK)
  async verifyPhoneCode(@Body() body: VerifyPhoneDto): Promise<{
    accessToken: string;
    refreshToken: string | null;
    idToken: string | null;
    expiresIn: number | null;
    tokenType: string | null;
  }> {
    const phoneE164 = this.normalizePhoneInput(body.phoneNumber);
    const session = body.session?.trim();
    const code = body.code?.trim();

    if (!session || !code) {
      throw new BadRequestException("Session and code are required");
    }

    const demoAccount = getDemoAccountByPhone(phoneE164);

    // Demo account bypass - verify with secret-prefixed code
    if (demoAccount && isDemoVerificationCode(code)) {
      this.logger.log(
        `Demo phone verification: ${phoneE164} (${demoAccount.label})`,
      );

      // Clean up the demo session
      await this.redis.safe(
        () =>
          this.redis.client.del([
            this.challengeMetaKey(session),
            this.challengeAttemptsKey(session),
          ]),
        { op: "del", key: `auth:challenge:${session}` },
      );

      // Create demo user in database
      await this.usersService.ensureUserExists(
        demoAccount.uid,
        null,
        phoneE164,
      );
      await this.warmCaches(demoAccount.uid);

      // Return a mock JWT-like token for the demo user
      // The token contains the demo UID and will be validated specially
      const demoPayload = {
        sub: demoAccount.uid,
        phone_number: phoneE164,
        token_use: "access",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      };
      const demoToken = `demo.${Buffer.from(JSON.stringify(demoPayload)).toString("base64")}.signature`;

      return {
        accessToken: demoToken,
        refreshToken: null,
        idToken: null,
        expiresIn: 3600,
        tokenType: "Bearer",
      };
    } else if (demoAccount) {
      // Demo phone but wrong code
      throw new UnauthorizedException("Invalid verification code");
    }

    await this.checkPhoneRateLimit(phoneE164, "verify");
    await this.getChallengeSession(session, phoneE164);

    try {
      const resp: RespondToAuthChallengeCommandOutput = await this.cognito.send(
        new RespondToAuthChallengeCommand({
          ChallengeName: "CUSTOM_CHALLENGE",
          ClientId: this.cognitoClientId,
          Session: session,
          ChallengeResponses: {
            USERNAME: phoneE164,
            ANSWER: code,
            SECRET_HASH: this.buildSecretHash(phoneE164),
          },
        }),
      );

      const result = resp.AuthenticationResult;
      if (!result || !result.AccessToken) {
        throw new UnauthorizedException("Invalid code");
      }

      const accessToken = result.AccessToken;
      const accessTokenType = typeof accessToken;
      const dotCount = (accessToken.match(/\./g) || []).length;
      console.error("[auth] verifyPhoneCode access token", {
        type: accessTokenType,
        value: accessToken,
        dotCount,
      });

      const payload = await verifyCognitoAccessToken(accessToken);
      const uid = payload.sub;
      if (!uid) {
        throw new UnauthorizedException("Missing subject in access token");
      }

      const email = payload.email;
      const phoneNumber = payload.phoneNumber ?? phoneE164;

      await this.usersService.ensureUserExists(uid, email, phoneNumber);
      await this.warmCaches(uid);

      await this.redis.safe(
        () =>
          this.redis.client.del([
            this.challengeMetaKey(session),
            this.challengeAttemptsKey(session),
          ]),
        { op: "del", key: `auth:challenge:${session}` },
      );

      return {
        accessToken,
        refreshToken: result.RefreshToken ?? null,
        idToken: result.IdToken ?? null,
        expiresIn: result.ExpiresIn ?? null,
        tokenType: result.TokenType ?? null,
      };
    } catch (err: unknown) {
      const errorCode =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : err instanceof Error
            ? err.name
            : undefined;
      const errorMessage = err instanceof Error ? err.message : undefined;
      const message =
        errorCode === "NotAuthorizedException"
          ? "Invalid or expired code"
          : (errorMessage ?? "Verification failed");
      this.logger.warn(
        `verifyPhoneCode failed for ${phoneE164}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new UnauthorizedException(message);
    }
  }

  //********************************************************************
  //
  // logout Method
  //
  // POST /auth/logout endpoint. Revokes all refresh tokens for the
  // authenticated user, invalidating all existing ID tokens immediately.
  // This ensures complete logout across all devices.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
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
   * POST /auth/logout
   * Revokes all refresh tokens for the authenticated user.
   * Invalidates all existing ID tokens immediately.
   */
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @AuthUser()
    user: {
      uid: string;
    },
  ): Promise<{ success: boolean }> {
    await Promise.resolve();
    if (!user || !user.uid) {
      throw new UnauthorizedException("User not authenticated");
    }

    // Cognito handles token revocation separately; for now, acknowledge logout.
    this.logger.log(`Logout requested for user: ${user.uid}`);
    return { success: true };
  }

  //********************************************************************
  //
  // refresh Method
  //
  // POST /auth/refresh endpoint. Identity rehydration endpoint that
  // mints a Firebase custom token for session restoration. Validates
  // user existence and account status (not disabled/deleted). Does NOT
  // require authentication (chicken-and-egg problem). Does NOT validate
  // ID tokens (they expire in 1 hour, causing false logouts).
  //
  // Security boundary: User existence + account status, not token freshness.
  //
  // Return Value
  // ------------
  //
  //
  // Value Parameters
  // ----------------
  // body    Object    Request body
  //   uid     string        Firebase UID to restore
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user    admin.auth.UserRecord    Firebase user record
  //
  //*******************************************************************
  /**
   * POST /auth/refresh
   * Identity rehydration endpoint. Mints a custom token if the user exists
   * and is not disabled.
   *
   * SECURITY:
   * - @Public: Bypasses global AuthGuard (Client has no token yet).
   * - Checks user.disabled status explicitly.
   * - Should be rate-limited by IP.
   */
  @Public() // <--- CRITICAL: Allows access without a token
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() _body: RefreshSessionDto,
    @Req() req: ExpressRequest,
  ): Promise<{ message: string }> {
    await Promise.resolve();
    const ip = req.ip || "unknown";
    this.logger.warn(
      `Refresh endpoint is disabled (Cognito handles refresh tokens). IP: ${ip}`,
    );
    throw new UnauthorizedException("Refresh not supported");
  }

  //********************************************************************
  //
  // checkRateLimit Method
  //
  // Checks rate limit for email verification requests. Allows 3 requests
  // per 15 minutes per user.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  //*******************************************************************
  private async checkRateLimit(uid: string): Promise<void> {
    const key = `email_verification_rate:${uid}`;
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxRequests = 3; // Max 3 requests per 15 minutes

    const count = await this.redis.safe(() => this.redis.client.incr(key), {
      op: "incr",
      key,
    });

    if (count === 1) {
      await this.redis.safe(
        () => this.redis.client.expire(key, Math.floor(windowMs / 1000)),
        { op: "expire", key },
      );
    }

    if (count !== null && count > maxRequests) {
      throw new BadRequestException(
        "Too many verification requests. Please try again later.",
      );
    }
  }

  //********************************************************************
  //
  // validateEmailDomain Method
  //
  // Validates that email domain ends with one of the allowed school domains.
  // Handles subdomains (e.g., login.missouristate.edu matches missouristate.edu).
  //
  // Return Value
  // ------------
  // boolean    True if domain is allowed
  //
  // Value Parameters
  // ----------------
  // email    string    Email address to validate
  //
  //*******************************************************************
  private validateEmailDomain(email: string): boolean {
    const normalized = email.toLowerCase();
    const domain = normalized.split("@").pop();
    if (!domain) return false;

    // Check if domain ends with any allowed domain (handles subdomains)
    return ALLOWED_SCHOOL_DOMAINS.some(
      (allowedDomain) =>
        domain === allowedDomain || domain.endsWith(`.${allowedDomain}`),
    );
  }

  //********************************************************************
  //
  // updateEmail Method
  //
  // POST /auth/update-email endpoint. Validates domain, checks if already
  // verified (one-time only), rate limits, and sends verification code.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean; message: string }>
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  // body    UpdateEmailDto    Email address
  //
  //*******************************************************************
  @Post("update-email")
  @HttpCode(HttpStatus.OK)
  async updateEmail(
    @AuthUser() user: { uid: string },
    @Body() body: UpdateEmailDto,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { email } = body;

      if (!email || typeof email !== "string") {
        throw new BadRequestException("Email is required");
      }

      const normalized = email.trim().toLowerCase();

      // Validate email format
      if (!normalized.includes("@")) {
        throw new BadRequestException("Invalid email format");
      }

      // Validate domain (handles subdomains)
      if (!this.validateEmailDomain(normalized)) {
        throw new BadRequestException(
          `Email must be from one of these domains: ${ALLOWED_SCHOOL_DOMAINS.join(", ")}`,
        );
      }

      // Check if user already verified email (one-time only)
      const alreadyVerified: boolean =
        await this.usersService.hasVerifiedSchoolEmail(user.uid);
      if (alreadyVerified) {
        throw new BadRequestException("Email already verified");
      }

      // Rate limiting
      await this.checkRateLimit(user.uid);

      // Send verification code
      await this.emailService.sendVerificationCode(user.uid, normalized);

      return {
        success: true,
        message: "Verification code sent to your email",
      };
    } catch (error) {
      // Re-throw known exceptions (BadRequestException, InternalServerErrorException, etc.)
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      // Log unexpected errors
      this.logger.error(
        `Unexpected error in updateEmail for user ${user.uid}`,
        error instanceof Error ? error.stack : String(error),
      );

      // Return generic error for unknown exceptions
      throw new InternalServerErrorException(
        "Failed to send verification email. Please try again later.",
      );
    }
  }

  //********************************************************************
  //
  // verifyEmail Method
  //
  // POST /auth/verify-email endpoint. Verifies code, updates user email,
  // grants bonus token if missouristate.edu, and marks verification as complete.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean; message: string; bonusTokenGranted: boolean }>
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  // body    VerifyEmailDto    Email and verification code
  //
  //*******************************************************************
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @AuthUser() user: { uid: string },
    @Body() body: VerifyEmailDto,
  ): Promise<{
    success: boolean;
    message: string;
    bonusTokenGranted: boolean;
  }> {
    const { email, code } = body;

    if (!email || !code) {
      throw new BadRequestException("Email and code are required");
    }

    const normalized = email.trim().toLowerCase();
    const normalizedCode = code.trim();

    // Verify code (case-insensitive, one-time use, expiration checked)
    const isValid = await this.emailService.verifyCode(
      user.uid,
      normalized,
      normalizedCode,
    );

    if (!isValid) {
      throw new BadRequestException("Invalid or expired verification code");
    }

    // Update user email and mark as verified
    await this.usersService.updateSchoolEmail(user.uid, normalized);
    await this.profilesService.syncSchoolFromVerifiedEmail(
      user.uid,
      normalized,
    );
    const isFirstVerificationForEmail =
      await this.usersService.markVerifiedSchoolEmail(normalized, user.uid);

    // Check if domain ends with missouristate.edu (handles subdomains)
    const domain = normalized.split("@").pop() || "";
    const isMissouriState =
      domain === "missouristate.edu" || domain.endsWith(".missouristate.edu");
    const emailInUse = await this.usersService.isSchoolEmailInUse(
      normalized,
      user.uid,
    );

    let bonusTokenGranted = false;
    if (isMissouriState && !emailInUse && isFirstVerificationForEmail) {
      // Grant 1 search token
      const userEntity = await this.usersService.getByUid(user.uid);
      if (userEntity) {
        await this.tokensService.grantAdminTokens(userEntity.id, "search", 1);
        bonusTokenGranted = true;
      }
    }

    return {
      success: true,
      message: "Email verified successfully",
      bonusTokenGranted,
    };
  }

  //********************************************************************
  //
  // warmCaches Method
  //
  // Asynchronously preloads key caches for the user after login/refresh.
  //
  //********************************************************************
  private async warmCaches(uid: string) {
    await Promise.allSettled([
      this.usersService.getByUid(uid),
      this.profilesService.getProfile(uid),
      this.matchesService.getMatches(uid),
      this.blocksService.getBlockSet(uid),
    ]);
  }
}
