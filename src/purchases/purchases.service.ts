//********************************************************************
//
// PurchasesService Class
//
// Service for managing in-app purchases. Handles receipt validation
// against store APIs, purchase recording, token grants, and purchase
// restoration. Supports both Apple App Store and Google Play Store.
//
// Return Value
// ------------
// None (NestJS service class)
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
// purchaseRepo    Repository<Purchase>    TypeORM repository for purchases
// usersRepo       Repository<User>        TypeORM repository for users
// tokens          TokensService           Token service for granting tokens
//
//*******************************************************************

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  NotImplementedException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, IsNull, EntityManager } from "typeorm";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "node:crypto";
import * as jwt from "jsonwebtoken";

import {
  Purchase,
  PurchasePlatform,
  PurchaseStore,
  PurchaseType,
} from "../database/entities/purchase.entity";
import { TokenLedger } from "../database/entities/token-ledger.entity";
import { User } from "../database/entities/user.entity";
import { TokensService } from "../tokens/tokens.service";
import { AuditEvent } from "../database/entities/audit-event.entity";
import { sanitizeForLogging } from "../utils/log-sanitizer";

interface ReceiptVerificationResult {
  valid: boolean;
  productId: string;
  transactionId: string;
  originalTransactionId?: string | null;
  storePurchaseIdentifier: string | null; // Store-scoped stable identifier
  store: PurchaseStore; // 'apple' | 'google'
  purchaseType: PurchaseType;
  expiresAt?: Date | null;
  isInGracePeriod?: boolean; // User is in billing retry grace period
  gracePeriodExpiresAt?: Date | null; // When grace period ends
}

interface ParsedReceipt {
  transactionId?: string;
  productId?: string;
  originalTransactionId?: string;
  expiresAt?: string | number;
  orderId?: string;
  purchaseToken?: string;
  obfuscatedAccountId?: string;
}

interface AppleTransactionPayload {
  transactionId: string;
  originalTransactionId?: string;
  productId: string;
  expiresDate?: string | number;
  bundleId?: string;
  revocationReason?: number;
  revocationDate?: string | number;
  inBillingRetryPeriod?: boolean;
  isInGracePeriod?: boolean;
  gracePeriodExpiresDate?: string | number;
}

interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface GoogleProductResponse {
  orderId?: string;
  purchaseState?: number;
  consumptionState?: number;
  acknowledgementState?: number;
  purchaseTimeMillis?: string;
  purchaseToken?: string;
}

interface GoogleSubscriptionResponse {
  orderId?: string;
  expiryTimeMillis?: string;
  paymentState?: number;
  acknowledgementState?: number;
  purchaseToken?: string;
  obfuscatedExternalAccountId?: string;
}

interface AppleServerNotification {
  notificationType?: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
    status?: number;
  };
}

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);
  private receiptEncryptionKey: Buffer | null | undefined;
  private readonly jwtService = new JwtService();

  constructor(
    @InjectRepository(Purchase)
    private readonly purchaseRepo: Repository<Purchase>,

    @InjectRepository(TokenLedger)
    private readonly ledgerRepo: Repository<TokenLedger>,

    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,

    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,

    private readonly httpService: HttpService,

    private readonly tokens: TokensService,
  ) {}

  private audit(event: string, payload: Record<string, unknown>) {
    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [
        k,
        sanitizeForLogging(String(v)),
      ]),
    );

    void this.auditRepo
      .insert({ event, payload: sanitizedPayload })
      .catch((err) =>
        this.logger.error(
          `Failed to persist audit event ${event}: ${sanitizeForLogging(
            err instanceof Error ? err.message : String(err),
          )}`,
        ),
      );

    this.logger.log(JSON.stringify({ event, ...sanitizedPayload }));
  }

  private parseReceipt(receipt: string): ParsedReceipt {
    try {
      return JSON.parse(receipt) as ParsedReceipt;
    } catch (error: unknown) {
      this.logger.warn(
        `Receipt parse failed: ${sanitizeForLogging(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
      throw new BadRequestException("Invalid receipt format");
    }
  }

  private getReceiptEncryptionKey(): Buffer | null {
    if (this.receiptEncryptionKey !== undefined) {
      return this.receiptEncryptionKey;
    }
    const rawKey = process.env.PURCHASE_RECEIPT_ENC_KEY;
    if (!rawKey) {
      this.receiptEncryptionKey = null;
      return null;
    }

    let key: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
      key = Buffer.from(rawKey, "hex");
    } else {
      key = Buffer.from(rawKey, "base64");
    }

    if (key.length !== 32) {
      throw new Error(
        "PURCHASE_RECEIPT_ENC_KEY must be 32 bytes (base64 or hex).",
      );
    }

    this.receiptEncryptionKey = key;
    return key;
  }

  private hashReceipt(receipt: string): string {
    const hash = crypto.createHash("sha256").update(receipt).digest("hex");
    return `sha256:${hash}`;
  }

  private encryptReceipt(receipt: string, key: Buffer): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(receipt, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const payload = {
      v: 1,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };

    return `enc:${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
  }

  private protectReceiptForStorage(receipt: string): string {
    const key = this.getReceiptEncryptionKey();
    if (!key) {
      if (process.env.NODE_ENV === "production") {
        this.logger.warn(
          "PURCHASE_RECEIPT_ENC_KEY missing; storing hashed receipt only.",
        );
      }
      return this.hashReceipt(receipt);
    }
    return this.encryptReceipt(receipt, key);
  }

  private base64UrlEncode(input: string): string {
    return Buffer.from(input).toString("base64url");
  }

  private buildAppStoreClientToken(): string {
    const privateKey = process.env.APP_STORE_KEY;
    const keyId = process.env.APP_STORE_KEY_ID;
    const issuerId = process.env.APP_STORE_ISSUER_ID;
    const bundleId =
      process.env.APP_STORE_BUNDLE_ID || process.env.APP_STORE_BUNDLE;

    if (!privateKey || !keyId || !issuerId || !bundleId) {
      throw new ForbiddenException("App Store validation not configured");
    }

    const now = Math.floor(Date.now() / 1000);

    return this.jwtService.sign(
      {
        iss: issuerId,
        iat: now,
        exp: now + 1800, // 30 minutes
        aud: "appstoreconnect-v1",
        bid: bundleId,
      },
      {
        algorithm: "ES256",
        keyid: keyId,
        secret: privateKey.replace(/\\n/g, "\n"),
        header: {
          alg: "ES256",
          kid: keyId,
          typ: "JWT",
        },
      },
    );
  }

  private appStoreEndpoint(): string {
    const env =
      process.env.APP_STORE_ENVIRONMENT ||
      (process.env.NODE_ENV === "production" ? "production" : "sandbox");
    return env === "sandbox"
      ? "https://api.storekit-sandbox.itunes.apple.com"
      : "https://api.storekit.itunes.apple.com";
  }

  private loadAppleRootCerts(): crypto.X509Certificate[] {
    const roots: string[] = [];
    const single = process.env.APPLE_ROOT_CERT_PEM;
    if (single) roots.push(single);
    const multiple = process.env.APPLE_ROOT_CERT_PEMS;
    if (multiple) {
      const parts = multiple
        .split("-----END CERTIFICATE-----")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => `${part}\n-----END CERTIFICATE-----\n`);
      roots.push(...parts);
    }

    const normalized = roots
      .map((pem) => pem.replace(/\\n/g, "\n").trim())
      .filter((pem) => pem.length > 0);

    if (normalized.length === 0) {
      throw new ForbiddenException("Apple root certificates not configured");
    }

    return normalized.map((pem) => new crypto.X509Certificate(pem));
  }

  private fingerprint(cert: crypto.X509Certificate): string {
    return crypto.createHash("sha256").update(cert.raw).digest("hex");
  }

  private validateAppleCertificateChain(x5c: string[]): crypto.X509Certificate {
    if (!Array.isArray(x5c) || x5c.length < 2) {
      throw new ForbiddenException("Apple certificate chain is incomplete");
    }

    const chain = x5c.map(
      (cert) => new crypto.X509Certificate(Buffer.from(cert, "base64")),
    );
    const roots = this.loadAppleRootCerts();
    const rootFingerprints = new Set(
      roots.map((root) => this.fingerprint(root)),
    );

    for (let i = 0; i < chain.length - 1; i += 1) {
      const current = chain[i];
      const issuer = chain[i + 1];
      if (current.issuer !== issuer.subject) {
        throw new ForbiddenException("Apple certificate issuer mismatch");
      }
      if (!current.verify(issuer.publicKey)) {
        throw new ForbiddenException("Apple certificate signature invalid");
      }

      const validFrom = new Date(current.validFrom).getTime();
      const validTo = new Date(current.validTo).getTime();
      const now = Date.now();
      if (!Number.isFinite(validFrom) || !Number.isFinite(validTo)) {
        throw new ForbiddenException("Apple certificate validity invalid");
      }
      if (now < validFrom || now > validTo) {
        throw new ForbiddenException("Apple certificate expired");
      }
    }

    const root = chain[chain.length - 1];
    const rootFingerprint = this.fingerprint(root);
    if (!rootFingerprints.has(rootFingerprint)) {
      throw new ForbiddenException("Apple root certificate not trusted");
    }

    const rootValidFrom = new Date(root.validFrom).getTime();
    const rootValidTo = new Date(root.validTo).getTime();
    const now = Date.now();
    if (!Number.isFinite(rootValidFrom) || !Number.isFinite(rootValidTo)) {
      throw new ForbiddenException("Apple root certificate validity invalid");
    }
    if (now < rootValidFrom || now > rootValidTo) {
      throw new ForbiddenException("Apple root certificate expired");
    }

    if (!root.verify(root.publicKey)) {
      throw new ForbiddenException("Apple root certificate invalid");
    }

    return chain[0];
  }

  private verifyAppleTransactionJws(signed: string): AppleTransactionPayload {
    const headerPart = signed.split(".")[0];
    let certPem: string | null = null;
    try {
      const headerJson = Buffer.from(headerPart, "base64url").toString("utf8");
      const header = JSON.parse(headerJson) as { x5c?: string[] };
      if (Array.isArray(header.x5c) && header.x5c.length > 0) {
        const leaf = this.validateAppleCertificateChain(header.x5c);
        certPem = leaf.toString();
      }
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(
        `Failed to parse Apple JWS header: ${sanitizeForLogging(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
    }

    if (!certPem) {
      throw new ForbiddenException("Missing Apple transaction certificate");
    }

    try {
      const decoded = jwt.verify(signed, certPem, {
        algorithms: ["ES256"],
      }) as AppleTransactionPayload;
      return decoded;
    } catch (err) {
      this.logger.error(
        `Apple transaction signature verification failed: ${sanitizeForLogging(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
      throw new ForbiddenException("Receipt validation failed");
    }
  }

  private determinePurchaseType(productId?: string): PurchaseType {
    return productId && productId.includes("subscription")
      ? "subscription"
      : "consumable";
  }

  private async validateAppleReceipt(
    parsed: ParsedReceipt,
  ): Promise<ReceiptVerificationResult> {
    if (!parsed.transactionId || !parsed.productId) {
      throw new BadRequestException("Invalid iOS receipt format");
    }

    const url = `${this.appStoreEndpoint()}/inApps/v1/transactions/${encodeURIComponent(
      parsed.transactionId,
    )}`;

    try {
      const bearer = this.buildAppStoreClientToken();
      const response = await firstValueFrom(
        this.httpService.get<{ signedTransactionInfo?: string }>(url, {
          headers: {
            Authorization: `Bearer ${bearer}`,
          },
        }),
      );

      const signed = response.data?.signedTransactionInfo;
      if (!signed) {
        throw new ForbiddenException("Missing transaction payload from Apple");
      }

      const transaction = this.verifyAppleTransactionJws(signed);

      if (transaction.revocationDate || transaction.revocationReason) {
        throw new ForbiddenException("Receipt revoked");
      }

      const purchaseType = this.determinePurchaseType(parsed.productId);
      const expiresAt =
        transaction.expiresDate !== undefined
          ? new Date(Number(transaction.expiresDate))
          : parsed.expiresAt
            ? new Date(parsed.expiresAt)
            : null;

      if (
        transaction.bundleId &&
        process.env.APP_STORE_BUNDLE_ID &&
        transaction.bundleId !== process.env.APP_STORE_BUNDLE_ID
      ) {
        throw new ForbiddenException("Receipt bundle mismatch");
      }

      // Handle grace period - user still has access during billing retry
      const isInGracePeriod =
        transaction.isInGracePeriod === true ||
        transaction.inBillingRetryPeriod === true;
      const gracePeriodExpiresAt = transaction.gracePeriodExpiresDate
        ? new Date(Number(transaction.gracePeriodExpiresDate))
        : null;

      // If subscription is expired but in grace period, extend expiresAt to grace period end
      const effectiveExpiresAt =
        isInGracePeriod && gracePeriodExpiresAt ? gracePeriodExpiresAt : expiresAt;

      return {
        valid: true,
        productId: transaction.productId,
        transactionId: transaction.transactionId,
        originalTransactionId: transaction.originalTransactionId || null,
        storePurchaseIdentifier:
          transaction.originalTransactionId || transaction.transactionId,
        store: "apple",
        purchaseType,
        expiresAt: effectiveExpiresAt,
        isInGracePeriod,
        gracePeriodExpiresAt,
      };
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotImplementedException
      ) {
        throw error;
      }

      this.logger.error(
        `Apple receipt validation failed: ${sanitizeForLogging(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
      throw new ForbiddenException("Receipt validation failed");
    }
  }

  //********************************************************************
  //
  // handleAppleServerNotification Method
  //
  // Processes Apple App Store Server Notifications v2. Verifies the
  // signedPayload and revokes entitlements on refund/revoke events.
  //
  //********************************************************************
  async handleAppleServerNotification(signedPayload: string): Promise<void> {
    if (!signedPayload) {
      throw new BadRequestException("Missing signedPayload");
    }

    try {
      const notification = this.verifyAppleTransactionJws(
        signedPayload,
      ) as AppleServerNotification;

      const type = notification.notificationType;
      const signedTxn = notification.data?.signedTransactionInfo;

      if (!signedTxn) {
        this.logger.warn("Apple notification missing transaction info");
        return;
      }

      const txn = this.verifyAppleTransactionJws(signedTxn);

      // Handle revocation/refund
      if (
        type &&
        ["REFUND", "DID_REVOKE", "REFUND_DECLINED", "REFUND_REVERSED"].includes(
          type,
        )
      ) {
        await this.revokePurchaseEntitlements(
          "apple",
          txn.transactionId,
          txn.originalTransactionId ?? txn.transactionId,
        );
      }

      // Handle expired subscriptions (billing failed after grace period)
      if (type === "EXPIRED") {
        await this.handleSubscriptionExpired(
          "apple",
          txn.transactionId,
          txn.originalTransactionId ?? txn.transactionId,
        );
      }

      // Log billing issues for monitoring (grace period started)
      if (type === "DID_FAIL_TO_RENEW") {
        this.audit("SUBSCRIPTION_BILLING_ISSUE", {
          store: "apple",
          transactionId: txn.transactionId,
          originalTransactionId: txn.originalTransactionId,
          notificationType: type,
        });
      }

      // Handle successful renewal after billing issue
      if (type === "DID_RENEW") {
        this.audit("SUBSCRIPTION_RENEWED", {
          store: "apple",
          transactionId: txn.transactionId,
          originalTransactionId: txn.originalTransactionId,
        });
      }
    } catch (err) {
      this.logger.error(
        `Apple server notification handling failed: ${sanitizeForLogging(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
      throw new ForbiddenException("Invalid server notification");
    }
  }

  private async getGoogleAccessToken(
    serviceAccount: GoogleServiceAccount,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const tokenUri =
      serviceAccount.token_uri || "https://oauth2.googleapis.com/token";

    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: tokenUri,
      exp: now + 3600,
      iat: now,
    };

    const signingInput = `${this.base64UrlEncode(
      JSON.stringify(header),
    )}.${this.base64UrlEncode(JSON.stringify(payload))}`;

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(
      serviceAccount.private_key.replace(/\\n/g, "\n"),
      "base64url",
    );

    const assertion = `${signingInput}.${signature}`;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });

    const tokenResponse = await firstValueFrom(
      this.httpService.post<{ access_token?: string }>(
        tokenUri,
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      ),
    );

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      throw new ForbiddenException("Google auth failed");
    }

    return accessToken;
  }

  private async validateGoogleReceipt(
    parsed: ParsedReceipt,
  ): Promise<ReceiptVerificationResult> {
    const googleValidationEnabled =
      process.env.GOOGLE_PLAY_VALIDATION_ENABLED === "true";

    if (!googleValidationEnabled) {
      this.logger.warn("google_validation_skipped_account_gate");
      throw new NotImplementedException("NOT_IMPLEMENTED");
    }

    if (!parsed.purchaseToken || !parsed.productId || !parsed.orderId) {
      throw new BadRequestException(
        "Invalid Android receipt format (orderId, productId, and purchaseToken required)",
      );
    }

    const serviceAccountRaw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;
    const packageName =
      process.env.ANDROID_PACKAGE_NAME || process.env.GOOGLE_PLAY_PACKAGE_NAME;

    if (!serviceAccountRaw || !packageName) {
      throw new ForbiddenException("Google Play validation not configured");
    }

    let serviceAccount: GoogleServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountRaw) as GoogleServiceAccount;
    } catch (error: unknown) {
      this.logger.error(
        `Invalid Google service account JSON: ${sanitizeForLogging(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
      throw new ForbiddenException("Google Play validation not configured");
    }

    try {
      const accessToken = await this.getGoogleAccessToken(serviceAccount);
      const purchaseType = this.determinePurchaseType(parsed.productId);

      const url =
        purchaseType === "subscription"
          ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
              packageName,
            )}/purchases/subscriptions/${encodeURIComponent(
              parsed.productId,
            )}/tokens/${encodeURIComponent(parsed.purchaseToken)}`
          : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
              packageName,
            )}/purchases/products/${encodeURIComponent(
              parsed.productId,
            )}/tokens/${encodeURIComponent(parsed.purchaseToken)}`;

      const response = await firstValueFrom(
        this.httpService.get<
          GoogleProductResponse | GoogleSubscriptionResponse
        >(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      if (purchaseType === "subscription") {
        const data = response.data as GoogleSubscriptionResponse;
        const expiresMillis = data.expiryTimeMillis
          ? Number(data.expiryTimeMillis)
          : null;

        if (!expiresMillis || expiresMillis <= Date.now()) {
          throw new ForbiddenException("Subscription expired or invalid");
        }

        if (data.paymentState !== undefined && data.paymentState < 1) {
          throw new ForbiddenException("Subscription not paid");
        }

        return {
          valid: true,
          productId: parsed.productId,
          transactionId: data.orderId || parsed.orderId,
          originalTransactionId: null,
          storePurchaseIdentifier: parsed.purchaseToken,
          store: "google",
          purchaseType: "subscription",
          expiresAt: new Date(expiresMillis),
        };
      }

      const data = response.data as GoogleProductResponse;

      if (data.purchaseState !== undefined && data.purchaseState !== 0) {
        throw new ForbiddenException("Purchase not completed");
      }

      if (
        data.acknowledgementState !== undefined &&
        data.acknowledgementState !== 1
      ) {
        throw new ForbiddenException("Purchase not acknowledged");
      }

      return {
        valid: true,
        productId: parsed.productId,
        transactionId: data.orderId || parsed.orderId,
        originalTransactionId: null,
        storePurchaseIdentifier: parsed.purchaseToken,
        store: "google",
        purchaseType: "consumable",
        expiresAt: null,
      };
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotImplementedException
      ) {
        throw error;
      }

      this.logger.error(
        `Google receipt validation failed: ${sanitizeForLogging(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
      throw new ForbiddenException("Receipt validation failed");
    }
  }

  //********************************************************************
  //
  // verifyReceipt Method
  //
  // Validates receipt against Apple/Google servers. Google validation
  // is gated by GOOGLE_PLAY_VALIDATION_ENABLED (returns NOT_IMPLEMENTED
  // when false). Apple validation requires App Store Connect API
  // credentials from secret manager.
  //
  //*******************************************************************
  private async verifyReceipt(
    platform: PurchasePlatform,
    receipt: string,
  ): Promise<ReceiptVerificationResult> {
    const parsed = this.parseReceipt(receipt);
    if (platform === "ios") {
      return this.validateAppleReceipt(parsed);
    }
    return this.validateGoogleReceipt(parsed);
  }

  //********************************************************************
  //
  // verifyPurchase Method
  //
  // Validates receipt, saves purchase, and grants tokens. Handles both
  // consumables and subscriptions.
  //
  // Return Value
  // ------------
  // Promise<Purchase>    Saved purchase entity
  //
  // Value Parameters
  // ----------------
  // userId      string              User ID
  // platform    PurchasePlatform    Platform (ios, android)
  // receipt     string              Receipt data
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user        User|null           User entity
  // verification ReceiptVerificationResult Verification result
  // existing    Purchase|null       Existing purchase with same transaction
  // purchase    Purchase            Purchase entity to save
  //
  //*******************************************************************
  async verifyPurchase(
    userId: string,
    platform: PurchasePlatform,
    receipt: string,
  ): Promise<Purchase> {
    // Verify receipt (server-side validation)
    const verification = await this.verifyReceipt(platform, receipt);
    const storedReceipt = this.protectReceiptForStorage(receipt);

    if (!verification.valid) {
      throw new BadRequestException("Receipt validation failed");
    }

    const saved = await this.purchaseRepo.manager.transaction(
      async (manager) => {
        const purchaseRepo = manager.getRepository(Purchase);
        const usersRepo = manager.getRepository(User);

        const user = await usersRepo.findOne({
          where: { id: userId, deletedAt: IsNull() },
        });
        if (!user) throw new NotFoundException("User not found");

        // Check for duplicate transaction by storePurchaseIdentifier (store-scoped)
        // This ensures purchases are uniquely identified by store account, not just userId
        const existing = await purchaseRepo.findOne({
          where: verification.storePurchaseIdentifier
            ? {
                store: verification.store,
                storePurchaseIdentifier: verification.storePurchaseIdentifier,
              }
            : {
                transactionId: verification.transactionId,
                platform,
              },
        });

        if (existing && existing.status === "verified") {
          // If purchase exists but is soft-deleted, restore it
          if (existing.deletedAt) {
            existing.deletedAt = null;
            existing.userId = userId; // Reassign to current user
            await purchaseRepo.save(existing);
          }
          return existing; // Already processed
        }

        // Create or update purchase
        const purchase = existing
          ? existing
          : purchaseRepo.create({
              userId,
              platform,

              store: verification.store,
              productId: verification.productId,
              transactionId: verification.transactionId,
              originalTransactionId: verification.originalTransactionId ?? null,
              storePurchaseIdentifier: verification.storePurchaseIdentifier,
              phoneHashDet: user.phoneHashDet ?? null, // Store phone hash for cross-account restore
              receipt: storedReceipt,
              purchaseType: verification.purchaseType,
              status: "verified",
              expiresAt: verification.expiresAt ?? null,
              deletedAt: null, // Ensure not soft-deleted
              verifiedAt: new Date(),
            });

        if (existing) {
          purchase.status = "verified";
          purchase.verifiedAt = new Date();
          purchase.deletedAt = null; // Clear soft-delete if restoring
          purchase.userId = userId; // Reassign to current user
          purchase.receipt = storedReceipt;
          if (verification.expiresAt) {
            purchase.expiresAt = verification.expiresAt;
          }
        }

        const savedPurchase = await purchaseRepo.save(purchase);

        // Grant tokens based on purchase type
        if (verification.purchaseType === "subscription") {
          // Update user subscription status
          user.isSubscribed = true;
          if (verification.expiresAt) {
            user.subscriptionExpiresAt = verification.expiresAt;
          }
          await usersRepo.save(user);

          // Grant subscription tokens
          if (verification.expiresAt) {
            await this.tokens.grantSubscriptionTokens(
              userId,
              verification.expiresAt,
              manager,
            );
          }
        } else {
          // Consumable purchase - grant tokens
          await this.grantPurchaseTokens(
            savedPurchase.id,
            userId,
            verification.productId,
            manager,
          );
        }

        return savedPurchase;
      },
    );

    this.audit("PURCHASE_VERIFIED", {
      userId,
      purchaseId: saved.id,
      store: verification.store,
      productId: verification.productId,
      purchaseType: verification.purchaseType,
      transactionId: verification.transactionId,
    });

    return saved;
  }

  //********************************************************************
  //
  // grantPurchaseTokens Method
  //
  // Grants tokens for a consumable purchase based on product ID.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // purchaseId    string    Purchase ID
  // userId        string    User ID
  // productId     string    Store product ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // tokenGrants   Array    Token grants based on product ID
  //
  //*******************************************************************
  private async grantPurchaseTokens(
    purchaseId: string,
    userId: string,
    productId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const ledgerRepo = manager
      ? manager.getRepository(TokenLedger)
      : this.ledgerRepo;
    // Map product IDs to token grants
    // Product IDs should match store configuration (e.g., "one_search", "one_undo", "one_message_request")
    const tokenGrants: Array<{
      tokenType: "undo" | "search" | "message_request";
      quantity: number;
    }> = [];

    if (productId.includes("search") || productId === "one_search") {
      tokenGrants.push({ tokenType: "search", quantity: 1 });
    } else if (productId.includes("undo") || productId === "one_undo") {
      tokenGrants.push({ tokenType: "undo", quantity: 1 });
    } else if (
      productId.includes("message_request") ||
      productId === "one_message_request"
    ) {
      tokenGrants.push({ tokenType: "message_request", quantity: 1 });
    }

    if (tokenGrants.length === 0) {
      this.logger.warn(
        `Unknown product mapping for purchase ${purchaseId}: ${sanitizeForLogging(
          productId,
        )}`,
      );
      return;
    }

    // Grant tokens
    for (const grant of tokenGrants) {
      const ledgerEntry = ledgerRepo.create({
        userId,
        tokenType: grant.tokenType,
        source: "purchase",
        quantity: grant.quantity,
        expiresAt: null, // Consumables never expire
        purchaseId,
        consumedAt: null,
      });

      await ledgerRepo.save(ledgerEntry);

      this.audit("PURCHASE_TOKENS_GRANTED", {
        userId,
        purchaseId,
        tokenType: grant.tokenType,
        quantity: grant.quantity,
      });
    }
  }

  //********************************************************************
  //
  // restorePurchases Method
  //
  // Restores active subscriptions and unused consumables for a user based on
  // store account (Apple or Google) OR phone number. Queries purchases by:
  // 1. store + storePurchaseIdentifier (primary - same store account)
  // 2. phoneHashDet (secondary - same phone number, different store account)
  //
  // This supports restoration after account deletion and re-signup, even
  // if the user signs in with a different Apple ID but the same phone number.
  // Includes soft-deleted purchases and reassigns them to current userId.
  //
  // Return Value
  // ------------
  // Promise<Purchase[]>    Array of restored purchases
  //
  // Value Parameters
  // ----------------
  // userId      string              User ID
  // platform    PurchasePlatform    Platform (ios, android) to identify store
  // receipt     string              Receipt data to extract storePurchaseIdentifier
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user                    User|null           User entity
  // verification            ReceiptVerificationResult Verification result
  // purchases               Purchase[]          Purchases found by store identifier
  // phoneHashPurchases      Purchase[]          Purchases found by phone hash
  // restored                Purchase[]         Restored purchases
  // purchase                Purchase           Purchase in loop
  // now                     Date               Current timestamp
  //
  //*******************************************************************
  async restorePurchases(
    userId: string,
    platform: PurchasePlatform,
    receipt: string,
  ): Promise<Purchase[]> {
    // Verify receipt to extract storePurchaseIdentifier
    const verification = await this.verifyReceipt(platform, receipt);
    if (!verification.valid || !verification.storePurchaseIdentifier) {
      // No purchases to restore if receipt is invalid or missing identifier
      return [];
    }
    const storePurchaseIdentifier = verification.storePurchaseIdentifier;

    return this.purchaseRepo.manager.transaction(async (manager) => {
      const purchaseRepo = manager.getRepository(Purchase);
      const usersRepo = manager.getRepository(User);
      const ledgerRepo = manager.getRepository(TokenLedger);

      const user = await usersRepo.findOne({
        where: { id: userId, deletedAt: IsNull() },
      });
      if (!user) throw new NotFoundException("User not found");

      // Find purchases by store + storePurchaseIdentifier (primary method)
      // This allows restoration after account deletion when user re-signs up
      // Include soft-deleted purchases (deletedAt IS NOT NULL)
      const purchases = await purchaseRepo.find({
        where: {
          store: verification.store,
          storePurchaseIdentifier,
          status: "verified",
        },
      });

      // Also find purchases by phone hash (secondary method)
      // This allows restoration when user has a different Apple ID but same phone number
      let phoneHashPurchases: Purchase[] = [];
      if (user.phoneHashDet) {
        phoneHashPurchases = await purchaseRepo.find({
          where: {
            phoneHashDet: user.phoneHashDet,
            status: "verified",
          },
        });

        // Filter out duplicates (purchases already found by store identifier)
        const existingIds = new Set(purchases.map((p) => p.id));
        phoneHashPurchases = phoneHashPurchases.filter(
          (p) => !existingIds.has(p.id),
        );
      }

      // Combine both sets of purchases
      const allPurchases = [...purchases, ...phoneHashPurchases];

      // If no purchases found, return empty array (idempotent - no error)
      if (allPurchases.length === 0) {
        return [];
      }

      const restored: Purchase[] = [];
      const now = new Date();

      for (const purchase of allPurchases) {
        // Reassign purchase to current userId and update phone hash
        purchase.userId = userId;
        purchase.phoneHashDet = user.phoneHashDet ?? purchase.phoneHashDet; // Update phone hash
        purchase.deletedAt = null; // Clear soft-delete

        if (purchase.purchaseType === "subscription") {
          // Check if subscription is still active
          if (purchase.expiresAt && purchase.expiresAt > now) {
            // Update user subscription status
            user.isSubscribed = true;
            user.subscriptionExpiresAt = purchase.expiresAt;
            await usersRepo.save(user);

            // Grant subscription tokens (this will delete old ones first)
            await this.tokens.grantSubscriptionTokens(
              userId,
              purchase.expiresAt,
              manager,
            );
            restored.push(purchase);
            this.audit("PURCHASE_RESTORED", {
              userId,
              purchaseId: purchase.id,
              store: purchase.store,
              purchaseType: purchase.purchaseType,
              storePurchaseIdentifier: purchase.storePurchaseIdentifier,
            });
          }
        } else {
          // Consumable - check if tokens are still unused
          // Query by purchaseId only (userId may have changed after restoration)
          const unusedTokens = await ledgerRepo.find({
            where: {
              purchaseId: purchase.id,
              consumedAt: IsNull(),
            },
          });

          if (unusedTokens.length > 0) {
            // Tokens already granted - update ledger entries to new userId
            for (const token of unusedTokens) {
              token.userId = userId;
              await ledgerRepo.save(token);
            }
            restored.push(purchase);
            this.audit("PURCHASE_RESTORED", {
              userId,
              purchaseId: purchase.id,
              store: purchase.store,
              purchaseType: purchase.purchaseType,
              storePurchaseIdentifier: purchase.storePurchaseIdentifier,
            });
          } else {
            // Re-grant consumable tokens
            await this.grantPurchaseTokens(
              purchase.id,
              userId,
              purchase.productId,
              manager,
            );
            restored.push(purchase);
            this.audit("PURCHASE_RESTORED", {
              userId,
              purchaseId: purchase.id,
              store: purchase.store,
              purchaseType: purchase.purchaseType,
              storePurchaseIdentifier: purchase.storePurchaseIdentifier,
            });
          }
        }
      }

      // Save all restored purchases (reassign userId, clear deletedAt, update phoneHashDet)
      await purchaseRepo.save(allPurchases);

      return restored;
    });
  }

  //********************************************************************
  //
  // handleSubscriptionExpired Method
  //
  // Handles subscription expiration after billing retry period ends.
  // Removes subscription status from user but does not mark purchase
  // as failed (it was valid, just expired). Called by webhook handler.
  //
  //********************************************************************
  private async handleSubscriptionExpired(
    store: PurchaseStore,
    transactionId?: string,
    storePurchaseIdentifier?: string | null,
  ): Promise<void> {
    await this.purchaseRepo.manager.transaction(async (manager) => {
      const purchaseRepo = manager.getRepository(Purchase);
      const usersRepo = manager.getRepository(User);
      const ledgerRepo = manager.getRepository(TokenLedger);

      const purchase = await purchaseRepo.findOne({
        where: storePurchaseIdentifier
          ? { store, storePurchaseIdentifier }
          : transactionId
            ? { store, transactionId }
            : undefined,
      });

      if (!purchase || purchase.purchaseType !== "subscription") {
        return;
      }

      const user =
        purchase.userId &&
        (await usersRepo.findOne({
          where: { id: purchase.userId, deletedAt: IsNull() },
        }));

      if (user) {
        // Remove subscription tokens (keep purchased tokens)
        await ledgerRepo.delete({
          userId: user.id,
          source: "subscription",
          consumedAt: IsNull(),
        });

        // Clear subscription status
        user.isSubscribed = false;
        user.subscriptionExpiresAt = null;
        await usersRepo.save(user);
      }

      this.audit("SUBSCRIPTION_EXPIRED", {
        purchaseId: purchase.id,
        userId: purchase.userId,
        store: purchase.store,
        transactionId: purchase.transactionId,
        storePurchaseIdentifier: purchase.storePurchaseIdentifier,
      });
    });
  }

  //********************************************************************
  //
  // revokePurchaseEntitlements Method
  //
  // Revokes entitlements for a purchase (refund/chargeback). Deletes
  // unconsumed purchase/subscription tokens and marks purchase failed.
  // Intended to be called by upstream webhook handlers.
  //
  //********************************************************************
  async revokePurchaseEntitlements(
    store: PurchaseStore,
    transactionId?: string,
    storePurchaseIdentifier?: string | null,
  ): Promise<void> {
    let auditPayload: {
      purchaseId: string;
      userId: string | null;
      store: PurchaseStore;
      transactionId: string;
      storePurchaseIdentifier: string | null;
    } | null = null;

    await this.purchaseRepo.manager.transaction(async (manager) => {
      const purchaseRepo = manager.getRepository(Purchase);
      const usersRepo = manager.getRepository(User);
      const ledgerRepo = manager.getRepository(TokenLedger);

      const purchase = await purchaseRepo.findOne({
        where: storePurchaseIdentifier
          ? { store, storePurchaseIdentifier }
          : transactionId
            ? { store, transactionId }
            : undefined,
      });

      if (!purchase) {
        this.logger.warn(
          `Purchase not found for revocation store=${store} txn=${sanitizeForLogging(
            transactionId ?? "n/a",
          )} spi=${sanitizeForLogging(storePurchaseIdentifier ?? "n/a")}`,
        );
        return;
      }

      const user =
        purchase.userId &&
        (await usersRepo.findOne({
          where: { id: purchase.userId, deletedAt: IsNull() },
        }));

      if (purchase.purchaseType === "subscription" && user) {
        await ledgerRepo.delete({
          userId: user.id,
          source: "subscription",
          consumedAt: IsNull(),
        });
        user.isSubscribed = false;
        user.subscriptionExpiresAt = null;
        await usersRepo.save(user);
      } else {
        await ledgerRepo.delete({
          purchaseId: purchase.id,
          consumedAt: IsNull(),
        });
      }

      purchase.status = "failed";
      purchase.deletedAt = purchase.deletedAt ?? new Date();
      await purchaseRepo.save(purchase);

      auditPayload = {
        purchaseId: purchase.id,
        userId: purchase.userId,
        store: purchase.store,
        transactionId: purchase.transactionId,
        storePurchaseIdentifier: purchase.storePurchaseIdentifier,
      };
    });

    if (auditPayload) {
      this.audit("PURCHASE_REVOKED", auditPayload);
    }
  }
}
