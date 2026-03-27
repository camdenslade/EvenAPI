//********************************************************************
//
// NotificationsService Class
//
// Service for sending push notifications via Apple Push Notification service.
// Handles sending notifications for message requests, request
// acceptance, and new chat messages.
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
// logger           Logger              NestJS logger instance
// EXPO_PUSH_API_URL string              Expo Push API endpoint URL
// usersRepo        Repository<User>     TypeORM repository for users
// httpService      HttpService         HTTP service for API requests
//
//*******************************************************************

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, IsNull } from "typeorm";
import * as http2 from "node:http2";
import { importPKCS8, SignJWT } from "jose";

import { User } from "../database/entities/user.entity";
import { sanitizeForLogging } from "../utils/log-sanitizer";
import { RedisService } from "../redis/redis.service";

interface ApnsPayload {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    sound: string;
  };
  data?: Record<string, any>;
}

interface ApnsConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  topic: string;
  baseUrl: string;
}

interface DecodedApnsResponse {
  reason?: string;
}

interface CachedApnsToken {
  value: string;
  expiresAtMs: number;
}

interface ApnsRequestResult {
  statusCode: number;
  responseBody: string;
}

type JsonRecord = Record<string, any>;
type ApnsSigningKey = Awaited<ReturnType<typeof importPKCS8>>;

interface SendNotificationOptions {
  title: string;
  body: string;
  data?: JsonRecord;
}

type AllowedPushType =
  | "match"
  | "message_request"
  | "review"
  | "new_message";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly pushCacheTtlSeconds = 900; // 15 minutes
  private readonly allowedPushTypes = new Set<AllowedPushType>([
    "match",
    "message_request",
    "review",
    "new_message",
  ]);
  private apnsSigningKeyPromise: Promise<ApnsSigningKey> | null = null;
  private apnsBearerToken: CachedApnsToken | null = null;

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly redis: RedisService,
  ) {}

  private getApnsConfig(): ApnsConfig | null {
    const teamId = process.env.APPLE_APNS_TEAM_ID?.trim();
    const keyId = process.env.APPLE_APNS_KEY_ID?.trim();
    const privateKey = process.env.APPLE_APNS_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const topic =
      process.env.APPLE_APNS_TOPIC?.trim() ||
      process.env.APPLE_BUNDLE_ID?.trim() ||
      "us.evendating.app";
    const baseUrl =
      process.env.APPLE_APNS_BASE_URL?.trim() ||
      (process.env.NODE_ENV === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com");

    if (!teamId || !keyId || !privateKey) {
      return null;
    }

    return {
      teamId,
      keyId,
      privateKey,
      topic,
      baseUrl,
    };
  }

  private async getApnsSigningKey(): Promise<ApnsSigningKey> {
    const config = this.getApnsConfig();
    if (!config) {
      throw new Error("APNs is not configured");
    }

    if (!this.apnsSigningKeyPromise) {
      this.apnsSigningKeyPromise = importPKCS8(config.privateKey, "ES256");
    }

    return this.apnsSigningKeyPromise;
  }

  private async getApnsBearerToken(config: ApnsConfig): Promise<string> {
    const now = Date.now();
    if (this.apnsBearerToken && this.apnsBearerToken.expiresAtMs > now + 60_000) {
      return this.apnsBearerToken.value;
    }

    const signingKey = await this.getApnsSigningKey();
    const issuedAt = Math.floor(now / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({
        alg: "ES256",
        kid: config.keyId,
      })
      .setIssuer(config.teamId)
      .setIssuedAt(issuedAt)
      .sign(signingKey);

    this.apnsBearerToken = {
      value: token,
      expiresAtMs: now + 50 * 60 * 1000,
    };

    return token;
  }

  private async sendApnsRequest(
    path: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<ApnsRequestResult> {
    const config = this.getApnsConfig();
    if (!config) {
      throw new Error("APNs is not configured");
    }

    const client = http2.connect(config.baseUrl);
    return await new Promise<ApnsRequestResult>((resolve, reject) => {
      client.on("error", reject);

      const req = client.request({
        ":method": "POST",
        ":path": path,
        ...headers,
      });

      let responseBody = "";
      let statusCode = 0;

      req.setEncoding("utf8");
      req.on("response", (responseHeaders) => {
        const rawStatus = responseHeaders[http2.constants.HTTP2_HEADER_STATUS];
        statusCode = typeof rawStatus === "number" ? rawStatus : Number(rawStatus ?? 0);
      });
      req.on("data", (chunk) => {
        responseBody += chunk;
      });
      req.on("end", () => {
        client.close();
        resolve({ statusCode, responseBody });
      });
      req.on("error", (error) => {
        client.close();
        reject(error);
      });

      req.end(body);
    });
  }

  private async sendApnsNotification(
    deviceToken: string,
    options: SendNotificationOptions,
  ): Promise<void> {
    const config = this.getApnsConfig();
    if (!config) {
      this.logger.warn("APNs not configured; skipping push delivery");
      return;
    }

    const apnsPayload: ApnsPayload = {
      aps: {
        alert: {
          title: options.title,
          body: options.body,
        },
        sound: "default",
      },
    };
    if (options.data) {
      apnsPayload.data = options.data;
    }

    const bearer = await this.getApnsBearerToken(config);
    const path = `/3/device/${deviceToken}`;
    const { statusCode, responseBody } = await this.sendApnsRequest(
      path,
      {
        authorization: `bearer ${bearer}`,
        "apns-topic": config.topic,
        "apns-push-type": "alert",
        "content-type": "application/json",
      },
      JSON.stringify(apnsPayload),
    );

    if (statusCode >= 200 && statusCode < 300) {
      return;
    }

    let reason = `HTTP ${statusCode}`;
    try {
      const parsed = JSON.parse(responseBody) as DecodedApnsResponse;
      if (typeof parsed.reason === "string") {
        reason = parsed.reason;
      }
    } catch {
    }

    throw new Error(reason);
  }

  private pushCacheKey(uid: string) {
    return `push:${uid}`;
  }

  private async getPushPreferences(uid: string): Promise<{
    pushToken: string | null;
    notificationsEnabled: boolean;
  } | null> {
    const cacheKey = this.pushCacheKey(uid);
    const cached = await this.redis.safe(
      () =>
        this.redis.getJson<{
          pushToken: string | null;
          notificationsEnabled: boolean;
        }>(cacheKey),
      { op: "getJson", key: cacheKey },
    );
    if (cached) return cached;

    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) return null;

    const prefs = {
      pushToken: user.pushToken,
      notificationsEnabled: user.notificationsEnabled !== false,
    };

    await this.redis.safe(
      () => this.redis.setJson(cacheKey, prefs, this.pushCacheTtlSeconds),
      {
        op: "setJson",
        key: cacheKey,
        ttlSeconds: this.pushCacheTtlSeconds,
      },
    );

    return prefs;
  }

  async invalidatePushCache(uid: string) {
    await this.redis.safe(() => this.redis.delete(this.pushCacheKey(uid)), {
      op: "delete",
      key: this.pushCacheKey(uid),
    });
  }

  //********************************************************************
  //
  // sendNotification Method
  //
  // Sends a push notification to a user via Expo Push API.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // recipientUid    string              Firebase UID of recipient
  // title           string              Notification title
  // body            string              Notification body
  // data            Record<string,any>  Optional notification data
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user        User|null         User entity from database
  // message     ExpoPushMessage   Push notification message
  // response    any               API response
  // err         Error             Error object if send fails
  //
  //*******************************************************************
  async sendNotification(
    recipientUid: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    try {
      const type = typeof data?.type === "string" ? data.type : null;
      if (!type || !this.allowedPushTypes.has(type as AllowedPushType)) {
        this.logger.debug(
          `Skipping push notification for ${recipientUid}; type ${String(type)} is not allowed`,
        );
        return;
      }

      const prefs = await this.getPushPreferences(recipientUid);

      if (!prefs || !prefs.pushToken || prefs.notificationsEnabled === false) {
        return;
      }

      await this.sendApnsNotification(prefs.pushToken, {
        title,
        body,
        data,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Error sending notification to ${recipientUid}: ${sanitizeForLogging(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
    }
  }

  //********************************************************************
  //
  // sendMessageRequestNotification Method
  //
  // Sends a notification for a new message request.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // recipientUid    string    Firebase UID of recipient
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
  async sendMessageRequestNotification(recipientUid: string): Promise<void> {
    await this.sendNotification(
      recipientUid,
      "New message request",
      "Someone wants to start a conversation",
      {
        type: "message_request",
      },
    );
  }

  //********************************************************************
  //
  // sendRequestAcceptedNotification Method
  //
  // Sends a notification when a message request is accepted.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // recipientUid    string    Firebase UID of recipient (sender of original request)
  // threadId        string    Thread ID for navigation
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
  async sendRequestAcceptedNotification(
    recipientUid: string,
    threadId: string,
  ): Promise<void> {
    await this.sendNotification(
      recipientUid,
      "Request accepted",
      "Your message request was accepted",
      {
        type: "request_accepted",
        threadId,
      },
    );
  }

  async sendMatchNotification(
    recipientUid: string,
    matchId: string,
  ): Promise<void> {
    await this.sendNotification(
      recipientUid,
      "It's a match",
      "You have a new match",
      {
        type: "match",
        matchId,
      },
    );
  }

  async sendReviewNotification(recipientUid: string): Promise<void> {
    await this.sendNotification(
      recipientUid,
      "New review",
      "Someone left you a new review",
      {
        type: "review",
      },
    );
  }

  //********************************************************************
  //
  // sendNewMessageNotification Method
  //
  // Sends a notification for a new chat message.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // recipientUid    string    Firebase UID of recipient
  // senderFirstName string   Sender's first name
  // messagePreview  string    Message preview text
  // threadId        string    Thread ID for navigation
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
  async sendNewMessageNotification(
    recipientUid: string,
    senderFirstName: string,
    messagePreview: string,
    threadId: string,
  ): Promise<void> {
    const truncatedPreview =
      messagePreview.length > 100
        ? messagePreview.substring(0, 100) + "..."
        : messagePreview;

    await this.sendNotification(
      recipientUid,
      senderFirstName,
      truncatedPreview,
      {
        type: "new_message",
        threadId,
      },
    );
  }
}
