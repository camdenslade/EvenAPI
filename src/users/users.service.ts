//********************************************************************
//
// UsersService Class
//
// Service for managing user accounts and identity. Handles user creation,
// location updates, review timeout enforcement, and full account deletion
// with safety identity persistence. Manages cascading deletion of all
// related data (profile, photos, matches, messages, reviews, etc.).
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
// usersRepo              Repository<User>                  TypeORM repository for users
// profilesRepo           Repository<Profile>               TypeORM repository for profiles
// likesRepo              Repository<Like>                  TypeORM repository for likes
// matchesRepo            Repository<Match>                 TypeORM repository for matches
// threadsRepo            Repository<Thread>                TypeORM repository for threads
// messagesRepo           Repository<Message>               TypeORM repository for messages
// reviewsRepo            Repository<Review>                TypeORM repository for reviews
// reviewStrikesRepo      Repository<ReviewStrike>          TypeORM repository for review strikes
// reviewWeekWindowRepo   Repository<ReviewWeekWindow>      TypeORM repository for review week windows
// reviewEmergencyRepo    Repository<ReviewEmergency>       TypeORM repository for review emergencies
// safetyRepo             Repository<SafetyIdentity>        TypeORM repository for safety identities
// s3                     S3Service                         S3 service for photo deletion
//
//*******************************************************************

import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In, IsNull } from "typeorm";

import {
  hashPhone,
  hashPhoneDeterministic,
  normalizePhoneToE164,
} from "../utils/phone-hash";
import { sanitizeForLogging } from "../utils/log-sanitizer";

import {
  User,
  ThemeColors,
  ThemePreset,
} from "../database/entities/user.entity";
import { Profile } from "../database/entities/profile.entity";
import { Like } from "../database/entities/like.entity";
import { Match } from "../database/entities/match.entity";
import { Thread } from "../database/entities/thread.entity";
import { Message } from "../database/entities/message.entity";
import { Review } from "../database/entities/review.entity";
import { ReviewStrike } from "../database/entities/review-strike.entity";
import { ReviewWeekWindow } from "../database/entities/review-week-window.entity";
import { ReviewEmergency } from "../database/entities/review-emergency.entity";
import { SafetyIdentity } from "../database/entities/safety-identity.entity";
import { Purchase } from "../database/entities/purchase.entity";
import { AuditEvent } from "../database/entities/audit-event.entity";
import { VerifiedSchoolEmail } from "../database/entities/verified-school-email.entity";

import { S3Service } from "../s3/s3.service";
import { TokensService } from "../tokens/tokens.service";
import { TokenType } from "../database/entities/token-ledger.entity";
import { UserResponseDto } from "./dto/user-response.dto";
import { RedisService } from "../redis/redis.service";
import { NotificationsService } from "../notifications/notifications.service";

type ImmutableUserCache = {
  id: string;
  uid: string;
  email: string | null;
  cognitoSub: string | null;
  appleSub: string | null;
  phoneHashDet: string | null;
  phoneE164Encrypted: string | null;
  safetyIdentityId: string | null;
  banned: boolean;
  bannedAt: Date | null;
  banReason: string | null;
  schoolEmailVerified: boolean;
  schoolEmailVerifiedAt: Date | null;
  deletedAt: Date | null;
  deletedReason: string | null;
};

type MutableUserCache = {
  latitude: number | null;
  longitude: number | null;
  lastLocationUpdate: Date | null;
  reviewTimeoutExpiresAt: Date | null;
  isSubscribed: boolean;
  searchTokens: number;
  messageTokens: number;
  undoTokens: number;
  pushToken: string | null;
  notificationsEnabled: boolean;
  subscriptionExpiresAt: Date | null;
  lastBaselineGrantAt: Date | null;
  paymentFlags?: {
    enablePayments: boolean;
    enableSearchTokens: boolean;
    enableUndoTokens: boolean;
    enableMessageReqTokens: boolean;
  };
  userFlags?: UserFlags;
};

type UserFlags = {
  unlimitedSearch: boolean;
  unlimitedUndo: boolean;
  unlimitedMessageReq: boolean;
};

const THEME_COLOR_KEYS: Array<keyof ThemeColors> = [
  "background",
  "card",
  "text",
  "subtitle",
  "accent",
  "circle",
  "shapeRect",
  "textSecondary",
  "buttonText",
  "overlay",
  "border",
  "bottomButton",
  "bottomButtonIcon",
];
const MAX_THEME_PRESETS = 20;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly userCacheTtlSeconds = 300; // 5 minutes
  private readonly tokenCacheTtlSeconds = 60;
  // Allow global env toggle to disable token purchase gates (e.g. for review/demo)
  // DISABLE_PAYMENT_GATES=true or ENABLE_PAYMENTS=false will turn off all token gating,
  // but only outside production to avoid accidental free access in prod.
  private readonly paymentGatesEnabled = (() => {
    if (process.env.NODE_ENV === "production") {
      return true;
    }
    return !(
      process.env.DISABLE_PAYMENT_GATES === "true" ||
      process.env.ENABLE_PAYMENTS === "false"
    );
  })();
  private readonly defaultPaymentFlags = {
    enablePayments: this.paymentGatesEnabled,
    enableSearchTokens: this.paymentGatesEnabled,
    enableUndoTokens: this.paymentGatesEnabled,
    enableMessageReqTokens: this.paymentGatesEnabled,
  };
  private readonly defaultUserFlags: UserFlags = {
    unlimitedSearch: false,
    unlimitedUndo: false,
    unlimitedMessageReq: false,
  };

  private userCacheKey(uid: string, version: number) {
    return `user:${uid}:v${version}`;
  }

  private immutableUserCacheKey(uid: string, version: number) {
    return `user:immutable:${uid}:v${version}`;
  }

  private mutableUserCacheKey(uid: string, version: number) {
    return `user:mutable:${uid}:v${version}`;
  }

  private userFlagsCacheKey(uid: string) {
    return `user:${uid}:flags`;
  }

  private tokenCacheKey(userId: string) {
    return `user:tokens:${userId}`;
  }

  private userToImmutable(user: User): ImmutableUserCache {
    return {
      id: user.id,
      uid: user.uid,
      email: user.email,
      cognitoSub: user.cognitoSub,
      appleSub: user.appleSub,
      phoneHashDet: user.phoneHashDet,
      phoneE164Encrypted: user.phoneE164Encrypted,
      safetyIdentityId: user.safetyIdentityId,
      banned: user.banned,
      bannedAt: user.bannedAt,
      banReason: user.banReason,
      schoolEmailVerified: user.schoolEmailVerified,
      schoolEmailVerifiedAt: user.schoolEmailVerifiedAt,
      deletedAt: user.deletedAt,
      deletedReason: user.deletedReason,
    };
  }

  private userToMutable(user: User): MutableUserCache {
    return {
      latitude: user.latitude,
      longitude: user.longitude,
      lastLocationUpdate: user.lastLocationUpdate,
      reviewTimeoutExpiresAt: user.reviewTimeoutExpiresAt,
      isSubscribed: user.isSubscribed,
      searchTokens: user.searchTokens,
      messageTokens: user.messageTokens,
      undoTokens: user.undoTokens,
      pushToken: user.pushToken,
      notificationsEnabled: user.notificationsEnabled,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      lastBaselineGrantAt: user.lastBaselineGrantAt,
      paymentFlags: this.defaultPaymentFlags,
      userFlags: this.defaultUserFlags,
    };
  }

  private isUserFlags(payload: unknown): payload is UserFlags {
    return (
      !!payload &&
      typeof payload === "object" &&
      "unlimitedSearch" in payload &&
      "unlimitedUndo" in payload &&
      "unlimitedMessageReq" in payload
    );
  }

  private isImmutableCache(payload: unknown): payload is ImmutableUserCache {
    return (
      !!payload &&
      typeof payload === "object" &&
      "uid" in payload &&
      "id" in payload
    );
  }

  private isMutableCache(payload: unknown): payload is MutableUserCache {
    return (
      !!payload && typeof payload === "object" && "isSubscribed" in payload
    );
  }

  private isThemeColors(payload: unknown): payload is ThemeColors {
    if (!payload || typeof payload !== "object") return false;
    const record = payload as Record<string, unknown>;
    return THEME_COLOR_KEYS.every((key) => typeof record[key] === "string");
  }

  private sanitizeThemePresets(payload: unknown): ThemePreset[] {
    if (!Array.isArray(payload)) return [];
    const seen = new Set<string>();
    const sanitized: ThemePreset[] = [];

    for (const entry of payload) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const name =
        typeof record.name === "string" ? record.name.trim().slice(0, 40) : "";
      const colors = record.colors;
      if (!id || !name || !this.isThemeColors(colors) || seen.has(id)) continue;
      seen.add(id);
      sanitized.push({
        id,
        name,
        colors,
        favorite: record.favorite === true,
      });
      if (sanitized.length >= MAX_THEME_PRESETS) break;
    }

    return sanitized;
  }

  private async invalidateUserCache(uid: string) {
    const version = await this.redis.getCacheVersion(uid);
    await Promise.all([
      this.redis.safe(
        () => this.redis.delete(this.userCacheKey(uid, version)),
        {
          op: "delete",
          key: this.userCacheKey(uid, version),
        },
      ),
      this.redis.safe(
        () => this.redis.delete(this.immutableUserCacheKey(uid, version)),
        { op: "delete", key: this.immutableUserCacheKey(uid, version) },
      ),
      this.redis.safe(
        () => this.redis.delete(this.mutableUserCacheKey(uid, version)),
        { op: "delete", key: this.mutableUserCacheKey(uid, version) },
      ),
    ]);
  }

  private async invalidateTokenCache(userId: string) {
    await this.redis.safe(() => this.redis.delete(this.tokenCacheKey(userId)), {
      op: "delete",
      key: this.tokenCacheKey(userId),
    });
  }

  async getUserFlags(
    uid: string,
    options: { requireUser?: boolean } = {},
  ): Promise<UserFlags> {
    if (options.requireUser) {
      const exists = await this.usersRepo.exist({
        where: { uid, deletedAt: IsNull() },
      });
      if (!exists) {
        throw new NotFoundException("User not found");
      }
    }

    const cached = await this.redis.safe(
      () => this.redis.getJson<unknown>(this.userFlagsCacheKey(uid)),
      { op: "getJson", key: this.userFlagsCacheKey(uid) },
    );

    const typed = this.isUserFlags(cached) ? cached : null;

    return {
      ...this.defaultUserFlags,
      ...(typed ?? {}),
    };
  }

  async setUserFlags(
    uid: string,
    flags: Partial<UserFlags>,
  ): Promise<UserFlags> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    const existing = await this.getUserFlags(uid, { requireUser: false });
    const sanitized: Partial<UserFlags> = {};
    if (flags.unlimitedSearch !== undefined)
      sanitized.unlimitedSearch = !!flags.unlimitedSearch;
    if (flags.unlimitedUndo !== undefined)
      sanitized.unlimitedUndo = !!flags.unlimitedUndo;
    if (flags.unlimitedMessageReq !== undefined)
      sanitized.unlimitedMessageReq = !!flags.unlimitedMessageReq;

    const merged = { ...existing, ...sanitized };

    await this.redis.safe(
      () => this.redis.setJson(this.userFlagsCacheKey(uid), merged),
      {
        op: "setJson",
        key: this.userFlagsCacheKey(uid),
      },
    );

    await this.redis.bumpCacheVersion(uid);
    await this.invalidateUserCache(uid);

    return merged;
  }
  private audit(event: string, payload: Record<string, unknown>) {
    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [
        k,
        sanitizeForLogging(String(v)),
      ]),
    );

    // Best-effort persistent audit record
    if (this.auditRepo) {
      void this.auditRepo
        .insert({ event, payload: sanitizedPayload })
        .catch((err) =>
          this.logger.error(
            `Failed to persist audit event ${event}: ${sanitizeForLogging(
              err instanceof Error ? err.message : String(err),
            )}`,
          ),
        );
    }

    this.logger.log(JSON.stringify({ event, ...sanitizedPayload }));
  }

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,

    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,

    @InjectRepository(Like)
    private readonly likesRepo: Repository<Like>,

    @InjectRepository(Match)
    private readonly matchesRepo: Repository<Match>,

    @InjectRepository(Thread)
    private readonly threadsRepo: Repository<Thread>,

    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,

    @InjectRepository(Review)
    private readonly reviewsRepo: Repository<Review>,

    @InjectRepository(ReviewStrike)
    private readonly reviewStrikesRepo: Repository<ReviewStrike>,

    @InjectRepository(ReviewWeekWindow)
    private readonly reviewWeekWindowRepo: Repository<ReviewWeekWindow>,

    @InjectRepository(ReviewEmergency)
    private readonly reviewEmergencyRepo: Repository<ReviewEmergency>,

    @InjectRepository(SafetyIdentity)
    private readonly safetyRepo: Repository<SafetyIdentity>,

    @InjectRepository(Purchase)
    private readonly purchasesRepo: Repository<Purchase>,

    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,

    @InjectRepository(VerifiedSchoolEmail)
    private readonly verifiedSchoolEmailRepo: Repository<VerifiedSchoolEmail>,

    private readonly s3: S3Service,
    private readonly tokensService: TokensService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  //********************************************************************
  //
  // ensureUserExists Method
  //
  // Ensures a User row exists for a Firebase UID. Creates user if missing,
  // or syncs email on every login or signup. Phone numbers are NEVER stored
  // in User entity - only hashed in SafetyIdentity for fraud prevention.
  //
  // Return Value
  // ------------
  // Promise<User>    User entity
  //
  // Value Parameters
  // ----------------
  // uid     string        Firebase UID
  // email   string|null   User's email address
  // phone   string|null   User's phone number (used only for SafetyIdentity hashing, NOT stored)
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user    User|null    Existing user or null
  //
  //*******************************************************************
  async ensureUserExists(
    uid: string,
    email: string | null,
    phone: string | null,
  ): Promise<User> {
    const normalizedPhone = phone ? normalizePhoneToE164(phone) : null;
    const phoneHashDet = normalizedPhone
      ? hashPhoneDeterministic(normalizedPhone)
      : null;

    let user = await this.usersRepo.findOne({ where: { uid } });
    const wasDeleted = !!user?.deletedAt;

    // Hash phone and find/create SafetyIdentity
    // CRITICAL: Phone hash matching does NOT block account creation, link accounts,
    // or create Block/SafetyExclusion records. It is internal-only for fraud prevention.
    let safetyIdentity: SafetyIdentity | null = null;
    if (phone) {
      const phoneHash = hashPhone(phone);
      safetyIdentity = await this.safetyRepo.findOne({
        where: { phoneHash },
      });

      if (!safetyIdentity) {
        safetyIdentity = this.safetyRepo.create({
          phoneHash,
          emergencyUsed: false,
          strikes: 0,
          lastReviewTimeout: null,
          lastSeenAt: new Date(),
          deletedCount: 0,
        });
        safetyIdentity = await this.safetyRepo.save(safetyIdentity);
      } else {
        // Update lastSeenAt
        safetyIdentity.lastSeenAt = new Date();
        await this.safetyRepo.save(safetyIdentity);
      }
    }

    if (!user) {
      // If phone is already registered under a different uid (e.g. user re-registered
      // after deleting their Cognito account), re-link to the existing DB account.
      if (phoneHashDet) {
        const existingByPhone = await this.usersRepo.findOne({
          where: { phoneHashDet },
          withDeleted: true,
        });
        if (existingByPhone) {
          existingByPhone.uid = uid;
          existingByPhone.email = email ?? existingByPhone.email;
          existingByPhone.safetyIdentityId =
            safetyIdentity?.id ?? existingByPhone.safetyIdentityId;
          if (existingByPhone.deletedAt) {
            existingByPhone.deletedAt = null;
            existingByPhone.deletedReason = null;
            existingByPhone.notificationsEnabled = true;
            existingByPhone.reviewTimeoutExpiresAt = null;
            await this.redis.bumpCacheVersion(existingByPhone.uid);
          }
          const saved = await this.usersRepo.save(existingByPhone);
          await this.cacheUser(saved);
          return saved;
        }
      }

      user = this.usersRepo.create({
        uid,
        email,
        cognitoSub: null,
        appleSub: null,
        phoneHashDet,
        phoneE164Encrypted: null,
        // Phone is NEVER stored in User entity - only hashed in SafetyIdentity
        reviewTimeoutExpiresAt: null,
        isSubscribed: false,
        searchTokens: 0,
        messageTokens: 0,
        undoTokens: 0,
        safetyIdentityId: safetyIdentity?.id ?? null,
        notificationsEnabled: true,
      });
      const saved = await this.usersRepo.save(user);
      await this.cacheUser(saved);
      return saved;
    }

    user.email = email ?? user.email;
    user.phoneHashDet = phoneHashDet ?? user.phoneHashDet;
    user.phoneE164Encrypted = user.phoneE164Encrypted ?? null;
    // Phone is NEVER stored in User entity - only hashed in SafetyIdentity
    user.safetyIdentityId = safetyIdentity?.id ?? user.safetyIdentityId;

    if (wasDeleted) {
      user.deletedAt = null;
      user.deletedReason = null;
      user.notificationsEnabled = true;
      user.reviewTimeoutExpiresAt = null;
      await this.redis.bumpCacheVersion(uid);
    }

    const saved = await this.usersRepo.save(user);
    await this.cacheUser(saved);
    return saved;
  }

  //********************************************************************
  //
  // getByUid Method
  //
  // Fetches user by Firebase UID.
  //
  // Return Value
  // ------------
  // Promise<User | null>    User entity or null
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
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
  async getByUid(
    uid: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<User | null> {
    const { includeDeleted = false } = options;
    const version = await this.redis.getCacheVersion(uid);
    const immutableKey = this.immutableUserCacheKey(uid, version);
    const mutableKey = this.mutableUserCacheKey(uid, version);

    const [immutable, mutable] = await Promise.all([
      this.redis.safe(() => this.redis.getJson<unknown>(immutableKey), {
        op: "getJson",
        key: immutableKey,
      }),
      this.redis.safe(() => this.redis.getJson<unknown>(mutableKey), {
        op: "getJson",
        key: mutableKey,
      }),
    ]);

    const immutableTyped = this.isImmutableCache(immutable) ? immutable : null;
    const mutableTyped = this.isMutableCache(mutable) ? mutable : null;

    if (immutableTyped && mutableTyped) {
      if (!includeDeleted && immutableTyped.deletedAt) {
        return null;
      }
      const mutableUser = mutableTyped as Partial<User> & {
        paymentFlags?: {
          enablePayments?: boolean;
          enableSearchTokens?: boolean;
          enableUndoTokens?: boolean;
          enableMessageReqTokens?: boolean;
        };
      };
      const merged: User = {
        ...immutableTyped,
        ...mutableUser,
        paymentFlags: this.defaultPaymentFlags,
        safetyIdentity: mutableUser.safetyIdentity ?? null,
        themePresets: mutableUser.themePresets ?? null,
      } as User;

      // If cached flags differ from current defaults, refresh cache lazily
      const cachedFlags = mutableUser.paymentFlags;
      const flagsMismatch =
        !cachedFlags ||
        cachedFlags.enablePayments !==
          this.defaultPaymentFlags.enablePayments ||
        cachedFlags.enableSearchTokens !==
          this.defaultPaymentFlags.enableSearchTokens ||
        cachedFlags.enableUndoTokens !==
          this.defaultPaymentFlags.enableUndoTokens ||
        cachedFlags.enableMessageReqTokens !==
          this.defaultPaymentFlags.enableMessageReqTokens;
      if (flagsMismatch) {
        await this.cacheUser(merged);
      }
      return merged;
    }

    const user = await this.usersRepo.findOne({
      where: includeDeleted ? { uid } : { uid, deletedAt: IsNull() },
    });
    if (user) {
      await this.cacheUser(user);
      if (!includeDeleted && user.deletedAt) {
        return null;
      }
    }
    return user;
  }

  //********************************************************************
  //
  // toResponseDto Method
  //
  // Converts User entity to UserResponseDto, excluding sensitive data
  // like phone numbers. Phone numbers are never returned in API responses.
  //
  // Return Value
  // ------------
  // UserResponseDto    User response DTO without sensitive data
  //
  // Value Parameters
  // ----------------
  // user    User    User entity to convert
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
  private async getTokenCount(
    userId: string,
    tokenType: TokenType,
  ): Promise<number> {
    try {
      return await this.tokensService.getAvailableTokens(userId, tokenType);
    } catch (err) {
      this.logger.warn(
        `Token count fallback for ${tokenType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  //********************************************************************
  //
  // syncTokenBalances Method
  //
  // Syncs token balances from TokenLedger to User entity columns.
  // This ensures User entity stays in sync with the ledger (source of truth).
  // Called after token grants/revocations for consistency.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // userId    string    User ID
  //
  //*******************************************************************
  async syncTokenBalances(userId: string): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { id: userId, deletedAt: IsNull() },
    });
    if (!user) return;

    const [undoTokens, searchTokens, messageTokens] = await Promise.all([
      this.getTokenCount(userId, "undo"),
      this.getTokenCount(userId, "search"),
      this.getTokenCount(userId, "message_request"),
    ]);

    user.undoTokens = undoTokens;
    user.searchTokens = searchTokens;
    user.messageTokens = messageTokens;
    await this.usersRepo.save(user);
    await this.invalidateTokenCache(userId);
    await this.invalidateUserCache(user.uid);
  }

  private async getCachedTokenCounts(
    userId: string,
  ): Promise<{ undo: number; search: number; message: number }> {
    const cacheKey = this.tokenCacheKey(userId);
    const cached = await this.redis.safe(
      () =>
        this.redis.getJson<{
          undo: number;
          search: number;
          message: number;
        }>(cacheKey),
      { op: "getJson", key: cacheKey },
    );
    if (cached) return cached;

    const [undoTokens, searchTokens, messageTokens] = await Promise.all([
      this.getTokenCount(userId, "undo"),
      this.getTokenCount(userId, "search"),
      this.getTokenCount(userId, "message_request"),
    ]);

    const payload = {
      undo: undoTokens,
      search: searchTokens,
      message: messageTokens,
    };

    await this.redis.safe(
      () => this.redis.setJson(cacheKey, payload, this.tokenCacheTtlSeconds),
      {
        op: "setJson",
        key: cacheKey,
        ttlSeconds: this.tokenCacheTtlSeconds,
      },
    );
    return payload;
  }

  private async cacheUser(user: User) {
    const version = await this.redis.getCacheVersion(user.uid);
    const immutable = this.userToImmutable(user);
    const userFlags = await this.getUserFlags(user.uid, { requireUser: false });
    const mutable = {
      ...this.userToMutable(user),
      userFlags,
    };

    await Promise.all([
      this.redis.safe(
        () =>
          this.redis.setJson(
            this.immutableUserCacheKey(user.uid, version),
            immutable,
            this.userCacheTtlSeconds,
          ),
        {
          op: "setJson",
          key: this.immutableUserCacheKey(user.uid, version),
          ttlSeconds: this.userCacheTtlSeconds,
        },
      ),
      this.redis.safe(
        () =>
          this.redis.setJson(
            this.mutableUserCacheKey(user.uid, version),
            mutable,
            this.userCacheTtlSeconds,
          ),
        {
          op: "setJson",
          key: this.mutableUserCacheKey(user.uid, version),
          ttlSeconds: this.userCacheTtlSeconds,
        },
      ),
      this.redis.safe(
        () =>
          this.redis.setJson(
            this.userCacheKey(user.uid, version),
            { ...immutable, ...mutable },
            this.userCacheTtlSeconds,
          ),
        {
          op: "setJson",
          key: this.userCacheKey(user.uid, version),
          ttlSeconds: this.userCacheTtlSeconds,
        },
      ),
    ]);
  }

  async toResponseDto(user: User): Promise<UserResponseDto> {
    // Phone numbers are never stored in User entity - they are only hashed
    // in SafetyIdentity for internal fraud prevention, so no exclusion needed
    const tokens = await this.getCachedTokenCounts(user.id);
    const userFlags = await this.getUserFlags(user.uid, { requireUser: false });

    return {
      id: user.id,
      uid: user.uid,
      email: user.email,
      latitude: user.latitude,
      longitude: user.longitude,
      lastLocationUpdate: user.lastLocationUpdate,
      reviewTimeoutExpiresAt: user.reviewTimeoutExpiresAt,
      isSubscribed: user.isSubscribed,
      searchTokens: tokens.search,
      messageTokens: tokens.message,
      undoTokens: tokens.undo,
      pushToken: user.pushToken,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      lastBaselineGrantAt: user.lastBaselineGrantAt,
      safetyIdentityId: user.safetyIdentityId,
      schoolEmailVerified: user.schoolEmailVerified,
      schoolEmailVerifiedAt: user.schoolEmailVerifiedAt,
      requireSchoolEmailGate: process.env.REQUIRE_SCHOOL_EMAIL_GATE === "true",
      paymentFlags: this.defaultPaymentFlags,
      userFlags,
    };
  }

  //********************************************************************
  //
  // updateLocation Method
  //
  // Updates a user's geographic location and timestamps the change.
  //
  // Return Value
  // ------------
  // Promise<Object>    Success response with location data
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  // lat    number    Latitude coordinate
  // lng    number    Longitude coordinate
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user    User|null    User entity from database
  //
  //*******************************************************************
  async updateLocation(uid: string, lat: number, lng: number) {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    user.latitude = lat;
    user.longitude = lng;
    user.lastLocationUpdate = new Date();

    await this.usersRepo.save(user);
    await this.redis.bumpCacheVersion(uid);
    await this.invalidateUserCache(uid);

    return {
      success: true,
      latitude: user.latitude,
      longitude: user.longitude,
      lastLocationUpdate: user.lastLocationUpdate,
    };
  }

  //********************************************************************
  //
  // setReviewTimeout Method
  //
  // Applies a temporary review timeout to a user.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // uid          string    Firebase UID
  // durationMs   number    Timeout duration in milliseconds
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user    User|null    User entity from database
  //
  //*******************************************************************
  async setReviewTimeout(uid: string, durationMs: number): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    user.reviewTimeoutExpiresAt = new Date(Date.now() + durationMs);
    await this.usersRepo.save(user);
    await this.invalidateUserCache(uid);
    await this.notifications.invalidatePushCache(uid);
  }

  //********************************************************************
  //
  // clearReviewTimeout Method
  //
  // Clears a review timeout from a user.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user    User|null    User entity from database
  //
  //*******************************************************************
  async clearReviewTimeout(uid: string): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    user.reviewTimeoutExpiresAt = null;
    await this.usersRepo.save(user);
    await this.invalidateUserCache(uid);
  }

  //********************************************************************
  //
  // getReviewTimeout Method
  //
  // Fetches review timeout expiration date for a user.
  //
  // Return Value
  // ------------
  // Promise<Date | null>    Expiration date or null
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user    User|null    User entity from database
  //
  //*******************************************************************
  async getReviewTimeout(uid: string): Promise<Date | null> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    return user.reviewTimeoutExpiresAt ?? null;
  }

  //********************************************************************
  //
  // isUserTimedOut Method
  //
  // Checks if user is currently timed out from reviewing.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if user is timed out
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user      User|null        User entity from database
  // expires   Date|null        Expiration date
  //
  //*******************************************************************
  async isUserTimedOut(uid: string): Promise<boolean> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    const expires = user.reviewTimeoutExpiresAt;
    if (!expires) return false;

    return expires.getTime() > Date.now();
  }

  //********************************************************************
  //
  // deleteUser Method
  //
  // Deletes a user and all related data. Persists SafetyIdentity metadata
  // before deletion to prevent abuse resets and ban evasion. Deletes
  // profile, photos, matches, threads, messages, reviews, strikes, and
  // all related entities. SafetyExclusion records are preserved (not deleted)
  // to maintain persistent safety enforcement across account deletion and re-signup.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user            User|null        User entity from database
  // emergencyUsed   boolean          Whether emergency reviews were used
  // strikeCount     number           Number of review strikes
  // profile         Profile|null     User's profile entity
  // key             string           Photo key in loop
  // matches         Match[]          Matches involving the user
  // matchIds        string[]         Array of match IDs
  //
  //*******************************************************************
  async deleteUser(
    uid: string,
    options: { soft?: boolean; reason?: string | null } = {},
  ): Promise<void> {
    const { soft = false, reason = null } = options;
    const user = await this.usersRepo.findOne({ where: { uid } });
    if (!user) return;

    const now = new Date();
    this.audit(soft ? "USER_SOFT_DELETE_START" : "DSAR_DELETE_START", {
      uid: sanitizeForLogging(uid),
    });

    // Update SafetyIdentity if exists
    if (user.safetyIdentityId) {
      const safetyIdentity = await this.safetyRepo.findOne({
        where: { id: user.safetyIdentityId },
      });

      if (safetyIdentity) {
        // Update safety metadata
        const emergencyUsed = await this.reviewEmergencyRepo.exist({
          where: [{ reviewer: { uid } }, { target: { uid } }],
        });

        const strikeCount = await this.reviewStrikesRepo.count({
          where: { user: { uid } },
        });

        safetyIdentity.emergencyUsed =
          emergencyUsed || safetyIdentity.emergencyUsed;
        safetyIdentity.strikes = Math.max(strikeCount, safetyIdentity.strikes);
        safetyIdentity.lastReviewTimeout =
          user.reviewTimeoutExpiresAt ?? safetyIdentity.lastReviewTimeout;
        safetyIdentity.deletedCount += 1;
        safetyIdentity.lastSeenAt = now;

        await this.safetyRepo.save(safetyIdentity);
      }
      // Note: Legacy phone check removed - phone is no longer stored in User entity.
      // SafetyIdentity is always linked via safetyIdentityId if it exists.
    }

    // Clear push token and disable notifications before delete (safety measure)
    user.pushToken = null;
    user.notificationsEnabled = false;

    if (soft) {
      user.deletedAt = now;
      user.deletedReason = reason ?? null;
      user.email = null;
      user.latitude = null;
      user.longitude = null;
      user.lastLocationUpdate = null;
      user.reviewTimeoutExpiresAt = null;
      user.subscriptionExpiresAt = null;
    }

    await this.usersRepo.save(user);

    const profile = await this.profilesRepo.findOne({
      where: { userUid: uid },
    });

    if (profile) {
      if (profile.photos?.length) {
        await Promise.all(
          profile.photos.map(async (key) => {
            if (!key) return;
            try {
              await this.s3.deleteObject(key);
            } catch {
              /* ignore S3 delete errors */
            }
          }),
        );
      }

      await this.profilesRepo.delete({ userUid: uid });
    }

    await this.reviewsRepo.delete({ reviewerUid: uid });
    await this.reviewsRepo.delete({ targetUid: uid });
    await this.reviewStrikesRepo.delete({ userId: user.id });
    await this.reviewWeekWindowRepo.delete({ userId: user.id });
    await this.reviewEmergencyRepo.delete({ reviewerId: user.id });
    await this.reviewEmergencyRepo.delete({ targetId: user.id });

    const matches = await this.matchesRepo.find({
      where: [{ userAUid: uid }, { userBUid: uid }],
    });

    const matchIds = matches.map((m) => m.id);

    if (matchIds.length > 0) {
      // Delete messages by threadId (TypeORM relation paths are not supported in delete queries)
      const threads = await this.threadsRepo.find({
        where: { matchId: In(matchIds) },
      });
      const threadIds = threads.map((t) => t.id);
      if (threadIds.length > 0) {
        await this.messagesRepo.delete({ threadId: In(threadIds) });
      }

      await this.threadsRepo.delete({ matchId: In(matchIds) });
      await this.matchesRepo.delete({ id: In(matchIds) });
    }

    await this.likesRepo.delete({ swiperUid: uid });
    await this.likesRepo.delete({ targetUid: uid });

    await this.usersRepo.manager.delete("message_requests", [
      { senderUid: uid },
      { recipientUid: uid },
    ]);

    // Delete Block records (social, user-visible)
    // SafetyExclusion records are NOT deleted - they persist across account deletion
    // by design to maintain persistent safety enforcement even after re-signup
    await this.usersRepo.manager.delete("blocks", [
      { blockerUid: uid },
      { blockedUid: uid },
    ]);

    if (!soft) {
      const userPurchases = await this.purchasesRepo.find({
        where: { userId: user.id },
      });
      if (userPurchases.length > 0) {
        for (const purchase of userPurchases) {
          purchase.deletedAt = now;
        }
        await this.purchasesRepo.save(userPurchases);
      }

      await this.usersRepo.manager.delete("token_ledger", { userId: user.id });
      await this.usersRepo.delete({ uid });
    }

    this.audit(soft ? "USER_SOFT_DELETE_COMPLETE" : "DSAR_DELETE_COMPLETE", {
      uid: sanitizeForLogging(uid),
    });
    await this.redis.bumpCacheVersion(uid);
    await this.invalidateUserCache(uid);
    if (user.id) {
      await this.invalidateTokenCache(user.id);
    }
    await this.notifications.invalidatePushCache(uid);
  }

  //********************************************************************
  //
  // getIdByUid Method
  //
  // Returns the internal numeric/uuid user.id for a given Firebase UID.
  //
  // Return Value
  // ------------
  // Promise<string>    Internal user ID
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user    User|null    User entity from database
  //
  //*******************************************************************
  async getIdByUid(uid: string): Promise<string> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    return user.id;
  }

  //********************************************************************
  //
  // getByInternalId Method
  //
  // Fetches user by internal primary key (user.id). Required for resolving
  // Note: Messages now use senderProfileId (Profile) instead of senderId (User).
  //
  // Return Value
  // ------------
  // Promise<User | null>    User entity or null
  //
  // Value Parameters
  // ----------------
  // id    string    Internal user ID
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
  async getByInternalId(id: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id, deletedAt: IsNull() } });
  }

  //********************************************************************
  //
  // getRepo Method
  //
  // Returns the TypeORM repository for User entities. Used for advanced
  // queries and operations.
  //
  // Return Value
  // ------------
  // Repository<User>    TypeORM repository
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
  // None
  //
  //*******************************************************************
  getRepo(): Repository<User> {
    return this.usersRepo;
  }

  //********************************************************************
  //
  // updatePushToken Method
  //
  // Updates a user's push notification token.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // uid         string    Firebase UID
  // pushToken   string    Expo push notification token
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user    User|null    User entity from database
  //
  //*******************************************************************
  async updatePushToken(uid: string, pushToken: string): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    user.pushToken = pushToken;
    await this.usersRepo.save(user);
    await this.redis.bumpCacheVersion(uid);
    await this.invalidateUserCache(uid);
    await this.notifications.invalidatePushCache(uid);
  }

  async getThemePresets(uid: string): Promise<ThemePreset[]> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
      select: ["id", "uid", "themePresets"],
    });
    if (!user) throw new NotFoundException("User not found");
    return this.sanitizeThemePresets(user.themePresets ?? []);
  }

  async setThemePresets(uid: string, presets: unknown): Promise<ThemePreset[]> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    const sanitized = this.sanitizeThemePresets(presets);
    user.themePresets = sanitized.length > 0 ? sanitized : null;

    await this.usersRepo.save(user);
    await this.redis.bumpCacheVersion(uid);
    await this.invalidateUserCache(uid);

    return sanitized;
  }

  //********************************************************************
  //
  // hasVerifiedSchoolEmail Method
  //
  // Checks if user has already verified their school email (one-time check).
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if user has verified email
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  //*******************************************************************
  async hasVerifiedSchoolEmail(uid: string): Promise<boolean> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) return false;
    return user.schoolEmailVerified === true;
  }

  //********************************************************************
  //
  // hasVerifiedSchoolEmailAddress Method
  //
  // Checks if the given school email has ever been verified (across
  // all accounts, including deleted).
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if email has been verified before
  //
  // Value Parameters
  // ----------------
  // email    string    Verified school email
  //
  //*******************************************************************
  async hasVerifiedSchoolEmailAddress(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;
    const existing = await this.verifiedSchoolEmailRepo.findOne({
      where: { email: normalized },
    });
    return Boolean(existing);
  }

  //********************************************************************
  //
  // markVerifiedSchoolEmail Method
  //
  // Records that a school email has been verified at least once.
  // Returns true if this is the first-ever verification for that email.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if email was verified for the first time
  //
  // Value Parameters
  // ----------------
  // email    string    Verified school email
  // uid      string    User UID that verified the email
  //
  //*******************************************************************
  async markVerifiedSchoolEmail(email: string, uid: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;

    const existing = await this.verifiedSchoolEmailRepo.findOne({
      where: { email: normalized },
    });

    if (existing) {
      existing.lastVerifiedByUid = uid;
      await this.verifiedSchoolEmailRepo.save(existing);
      return false;
    }

    const record = this.verifiedSchoolEmailRepo.create({
      email: normalized,
      lastVerifiedByUid: uid,
    });
    await this.verifiedSchoolEmailRepo.save(record);
    return true;
  }

  //********************************************************************
  //
  // isSchoolEmailInUse Method
  //
  // Checks if a school email is already used by another active user.
  // Excludes the given uid when provided.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if email is in use by someone else
  //
  // Value Parameters
  // ----------------
  // email       string    Email to check
  // excludeUid  string    UID to exclude from the check
  //
  //*******************************************************************
  async isSchoolEmailInUse(
    email: string,
    excludeUid?: string,
  ): Promise<boolean> {
    const normalized = email.toLowerCase();
    const existing = await this.usersRepo.findOne({
      where: { email: normalized, deletedAt: IsNull() },
    });
    if (!existing) return false;
    if (excludeUid && existing.uid === excludeUid) return false;
    return true;
  }

  //********************************************************************
  //
  // updateSchoolEmail Method
  //
  // Updates user's email and marks it as verified. Sets verification
  // timestamp.
  //
  // Return Value
  // ------------
  // Promise<User>    Updated user entity
  //
  // Value Parameters
  // ----------------
  // uid     string    Firebase UID
  // email   string    Verified school email
  //
  //*******************************************************************
  async updateSchoolEmail(uid: string, email: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    user.email = email.toLowerCase();
    user.schoolEmailVerified = true;
    user.schoolEmailVerifiedAt = new Date();

    const saved = await this.usersRepo.save(user);
    await this.redis.bumpCacheVersion(uid);
    return saved;
  }

  //********************************************************************
  //
  // hasUsedEmergencyReview Method
  //
  // Checks if a SafetyIdentity has used their emergency review.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if emergency review has been used
  //
  // Value Parameters
  // ----------------
  // safetyIdentityId    string    SafetyIdentity ID
  //
  //*******************************************************************
  async hasUsedEmergencyReview(safetyIdentityId: string): Promise<boolean> {
    const safetyIdentity = await this.safetyRepo.findOne({
      where: { id: safetyIdentityId },
    });
    return safetyIdentity?.emergencyUsed ?? false;
  }

  //********************************************************************
  //
  // markEmergencyReviewUsed Method
  //
  // Marks emergency review as used in SafetyIdentity.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // safetyIdentityId    string    SafetyIdentity ID
  //
  //*******************************************************************
  async markEmergencyReviewUsed(safetyIdentityId: string): Promise<void> {
    const safetyIdentity = await this.safetyRepo.findOne({
      where: { id: safetyIdentityId },
    });
    if (safetyIdentity) {
      safetyIdentity.emergencyUsed = true;
      await this.safetyRepo.save(safetyIdentity);
    }
  }
}
