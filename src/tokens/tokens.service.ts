//********************************************************************
//
// TokensService Class
//
// Service for managing token entitlements via TokenLedger. Handles
// monthly baseline grants, token availability calculation, token
// consumption with priority ordering, and subscription token grants.
// Token ledger is the single source of truth for all token entitlements.
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
// ledgerRepo    Repository<TokenLedger>    TypeORM repository for token ledger
// usersRepo     Repository<User>           TypeORM repository for users
//
//*******************************************************************

import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, IsNull, EntityManager } from "typeorm";

import {
  TokenLedger,
  TokenType,
  TokenSource,
} from "../database/entities/token-ledger.entity";
import { User } from "../database/entities/user.entity";
import { AuditEvent } from "../database/entities/audit-event.entity";
import { sanitizeForLogging } from "../utils/log-sanitizer";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly tokenCacheTtlSeconds = 60; // tokens are strongly consistent; cache is short-lived

  private tokenCacheKey(userId: string) {
    return `user:tokens:${userId}`;
  }

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

  constructor(
    @InjectRepository(TokenLedger)
    private readonly ledgerRepo: Repository<TokenLedger>,

    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,

    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,

    private readonly redis: RedisService,
  ) {}

  //********************************************************************
  //
  // grantAdminTokens Method
  //
  // Grants tokens via admin action. Records audit and uses ledger as
  // the single source of truth.
  //
  //********************************************************************
  async grantAdminTokens(
    userId: string,
    tokenType: TokenType,
    quantity: number,
  ): Promise<void> {
    if (quantity <= 0) return;

    await this.ledgerRepo.save(
      this.ledgerRepo.create({
        userId,
        tokenType,
        source: "baseline", // admin grants treated as baseline/non-expiring
        quantity,
        expiresAt: null,
        purchaseId: null,
        consumedAt: null,
      }),
    );

    this.audit("TOKENS_ADMIN_GRANTED", {
      userId,
      tokenType,
      quantity,
    });

    await this.invalidateTokenCache(userId);
  }

  //********************************************************************
  //
  // ensureMonthlyBaseline Method
  //
  // Grants 5 undo tokens per calendar month if not already granted
  // this month. Called on-demand before token checks. Resets monthly
  // on the 1st of each month.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // userId    string    User ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user              User|null         User entity
  // now               Date              Current date
  // currentMonthStart Date              Start of current calendar month
  // lastGrant         Date|null         Last baseline grant date
  // needsGrant        boolean           Whether baseline needs to be granted
  // monthEnd          Date              End of current calendar month
  //
  //*******************************************************************
  async ensureMonthlyBaseline(userId: string): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { id: userId, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastGrant = user.lastBaselineGrantAt;

    // Check if grant is needed (last grant was in a previous month or never)
    const needsGrant = !lastGrant || lastGrant < currentMonthStart;

    if (!needsGrant) {
      return;
    }

    // Calculate end of current month
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // Create baseline ledger entry
    await this.ledgerRepo.save(
      this.ledgerRepo.create({
        userId,
        tokenType: "undo",
        source: "baseline",
        quantity: 5,
        expiresAt: monthEnd,
        purchaseId: null,
        consumedAt: null,
      }),
    );

    // Update user's last baseline grant timestamp
    user.lastBaselineGrantAt = now;
    await this.usersRepo.save(user);

    this.audit("TOKENS_BASELINE_GRANTED", {
      userId,
      tokenType: "undo",
      quantity: 5,
      expiresAt: monthEnd.toISOString(),
    });

    await this.invalidateTokenCache(userId);
  }

  //********************************************************************
  //
  // getAvailableTokens Method
  //
  // Calculates available tokens of a given type for a user by summing
  // unconsumed, non-expired ledger entries. No caching - always
  // calculates from ledger (source of truth).
  //
  // Return Value
  // ------------
  // Promise<number>    Number of available tokens
  //
  // Value Parameters
  // ----------------
  // userId      string      User ID
  // tokenType   TokenType   Type of token to count
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // now         Date              Current timestamp
  // entries     TokenLedger[]     Available ledger entries
  // total       number            Sum of quantities
  //
  //*******************************************************************
  async getAvailableTokens(
    userId: string,
    tokenType: TokenType,
  ): Promise<number> {
    const now = new Date();

    const entries = await this.ledgerRepo.find({
      where: {
        userId,
        tokenType,
        consumedAt: IsNull(),
        // expiresAt is null OR expiresAt > now
      },
    });

    // Filter out expired entries
    const validEntries = entries.filter(
      (entry) => !entry.expiresAt || entry.expiresAt > now,
    );

    // Sum quantities
    const total = validEntries.reduce((sum, entry) => sum + entry.quantity, 0);

    return total;
  }

  //********************************************************************
  //
  // consumeToken Method
  //
  // Consumes one token of the specified type using priority order:
  // 1. Baseline tokens (oldest expiration first)
  // 2. Subscription tokens (oldest expiration first)
  // 3. Purchase tokens (oldest creation first)
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if token was consumed, false if none available
  //
  // Value Parameters
  // ----------------
  // userId      string      User ID
  // tokenType   TokenType   Type of token to consume
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // now         Date              Current timestamp
  // baseline    TokenLedger|null  Baseline token entry
  // subscription TokenLedger|null Subscription token entry
  // purchase    TokenLedger|null  Purchase token entry
  // target      TokenLedger|null  Entry to consume
  //
  //*******************************************************************
  async consumeToken(userId: string, tokenType: TokenType): Promise<boolean> {
    const now = new Date();

    // Ensure baseline is current before consumption
    await this.ensureMonthlyBaseline(userId);

    // Find available entries (unconsumed, not expired)
    const available = await this.ledgerRepo.find({
      where: {
        userId,
        tokenType,
        consumedAt: IsNull(),
      },
      order: {
        expiresAt: "ASC", // nulls last (purchases)
        createdAt: "ASC",
      },
    });

    // Filter out expired entries
    const valid = available.filter(
      (entry) => !entry.expiresAt || entry.expiresAt > now,
    );

    if (valid.length === 0) {
      return false;
    }

    // Priority order: baseline → subscription → purchase
    // Sort: baseline first, then subscription, then purchase
    // Within each group, oldest expiration first (or oldest creation for purchases)
    valid.sort((a, b) => {
      // Priority by source
      const sourceOrder: Record<TokenSource, number> = {
        baseline: 1,
        subscription: 2,
        purchase: 3,
      };

      const aPriority = sourceOrder[a.source];
      const bPriority = sourceOrder[b.source];

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Same source: sort by expiration (nulls last)
      if (a.expiresAt && b.expiresAt) {
        return a.expiresAt.getTime() - b.expiresAt.getTime();
      }

      if (a.expiresAt) return -1;
      if (b.expiresAt) return 1;

      // Both null (purchases): oldest creation first
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    // Consume the first (highest priority) entry
    const target = valid[0];

    // Mark as consumed
    target.consumedAt = now;
    await this.ledgerRepo.save(target);

    this.audit("TOKEN_CONSUMED", {
      userId,
      tokenType,
      ledgerId: target.id,
      source: target.source,
    });

    await this.invalidateTokenCache(userId);
    return true;
  }

  //********************************************************************
  //
  // grantSubscriptionTokens Method
  //
  // Grants subscription tokens on renewal. Deletes ALL unconsumed
  // subscription tokens first, then grants fresh ones. Tokens expire
  // at subscription expiration date.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // userId      string    User ID
  // expiresAt   Date      Subscription expiration date
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // now         Date              Current timestamp
  // unconsumed  TokenLedger[]     Unconsumed subscription tokens
  //
  //*******************************************************************
  async grantSubscriptionTokens(
    userId: string,
    expiresAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    const ledgerRepo = manager
      ? manager.getRepository(TokenLedger)
      : this.ledgerRepo;

    // Delete ALL unconsumed subscription tokens (renewal resets, doesn't accumulate)
    await ledgerRepo.delete({
      userId,
      source: "subscription",
      consumedAt: IsNull(),
    });

    // Grant fresh subscription tokens
    const grants = [
      { tokenType: "undo" as TokenType, quantity: 5 },
      { tokenType: "search" as TokenType, quantity: 3 },
      { tokenType: "message_request" as TokenType, quantity: 5 },
    ];

    for (const grant of grants) {
      await ledgerRepo.save(
        ledgerRepo.create({
          userId,
          tokenType: grant.tokenType,
          source: "subscription",
          quantity: grant.quantity,
          expiresAt,
          purchaseId: null, // Will be set when Purchase entity is linked
          consumedAt: null,
        }),
      );
    }

    this.audit("TOKENS_SUBSCRIPTION_GRANTED", {
      userId,
      expiresAt: expiresAt.toISOString(),
    });

    await this.invalidateTokenCache(userId);
  }

  private async invalidateTokenCache(userId: string) {
    await this.redis.safe(() => this.redis.delete(this.tokenCacheKey(userId)), {
      op: "delete",
      key: this.tokenCacheKey(userId),
    });
  }
}
