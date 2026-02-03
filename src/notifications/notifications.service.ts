//********************************************************************
//
// NotificationsService Class
//
// Service for sending push notifications via Expo Push API.
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
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

import { User } from "../database/entities/user.entity";
import { sanitizeForLogging } from "../utils/log-sanitizer";
import { RedisService } from "../redis/redis.service";

interface ExpoPushMessage {
  to: string;
  sound?: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

interface ExpoPushResponse {
  data: {
    data: Array<{
      status: "ok" | "error";
      message?: string;
    }>;
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";
  private readonly pushCacheTtlSeconds = 900; // 15 minutes

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly httpService: HttpService,
    private readonly redis: RedisService,
  ) {}

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
      const prefs = await this.getPushPreferences(recipientUid);

      if (!prefs || !prefs.pushToken || prefs.notificationsEnabled === false) {
        return;
      }

      const message: ExpoPushMessage = {
        to: prefs.pushToken,
        sound: "default",
        title,
        body,
        data,
      };

      const response = await firstValueFrom(
        this.httpService.post<ExpoPushResponse>(
          this.EXPO_PUSH_API_URL,
          [message],
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );

      // Type guard for Expo push response
      const responseData = response.data as ExpoPushResponse | undefined;
      const result =
        responseData && Array.isArray(responseData.data?.data)
          ? responseData.data.data[0]
          : undefined;
      if (result && result.status === "error") {
        const msg =
          typeof result.message === "string" ? result.message : "Unknown error";
        this.logger.warn(
          `Failed to send notification to ${recipientUid}: ${sanitizeForLogging(msg)}`,
        );
      }
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
