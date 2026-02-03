//********************************************************************
//
// BlocksService Class
//
// Service for managing user blocks and persistent safety exclusions.
// Handles block creation (which also creates SafetyExclusion for persistent
// enforcement), block removal (which only removes Block, preserving
// SafetyExclusion), and safety exclusion enforcement.
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
// blockRepo              Repository<Block>              TypeORM repository for blocks
// safetyExclusionRepo    Repository<SafetyExclusion>    TypeORM repository for safety exclusions
// safetyRepo             Repository<SafetyIdentity>     TypeORM repository for safety identities
// usersRepo              Repository<User>               TypeORM repository for users
//
//*******************************************************************

import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Repository } from "typeorm";

import { Block } from "../database/entities/block.entity";
import { SafetyExclusion } from "../database/entities/safety-exclusion.entity";
import { SafetyIdentity } from "../database/entities/safety-identity.entity";
import { User } from "../database/entities/user.entity";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class BlocksService {
  private readonly blockCacheTtlSeconds = 300; // 5 minutes
  private readonly exclusionCacheTtlSeconds = 300; // 5 minutes
  private readonly emptySentinel = "__empty__";

  constructor(
    @InjectRepository(Block)
    private readonly blockRepo: Repository<Block>,

    @InjectRepository(SafetyExclusion)
    private readonly safetyExclusionRepo: Repository<SafetyExclusion>,

    @InjectRepository(SafetyIdentity)
    private readonly safetyRepo: Repository<SafetyIdentity>,

    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,

    private readonly redis: RedisService,
  ) {}

  private blockCacheKey(uid: string, version: number) {
    return `blocks:set:${uid}:v${version}`;
  }

  private exclusionCacheKey(uid: string, version: number) {
    return `blocks:exclusion:${uid}:v${version}`;
  }

  private filterSentinel(values: string[]): string[] {
    return values.filter((v) => v !== this.emptySentinel);
  }

  private async invalidateBlockCache(uids: string[]) {
    const entries = await Promise.all(
      uids.map(async (uid) => ({
        uid,
        version: await this.redis.getCacheVersion(uid),
      })),
    );
    await Promise.all(
      entries.map(({ uid, version }) =>
        this.redis.safe(
          () => this.redis.delete(this.blockCacheKey(uid, version)),
          {
            op: "delete",
            key: this.blockCacheKey(uid, version),
          },
        ),
      ),
    );
  }

  private async invalidateExclusionCache(uids: string[]) {
    const entries = await Promise.all(
      uids.map(async (uid) => ({
        uid,
        version: await this.redis.getCacheVersion(uid),
      })),
    );
    await Promise.all(
      entries.map(({ uid, version }) =>
        this.redis.safe(
          () => this.redis.delete(this.exclusionCacheKey(uid, version)),
          {
            op: "delete",
            key: this.exclusionCacheKey(uid, version),
          },
        ),
      ),
    );
  }

  async listBlockedUids(blockerUid: string): Promise<string[]> {
    // Legacy helper: keep using the broader block set (both directions) so callers
    // don’t accidentally miss safety exclusions or mutual blocks.
    const set = await this.getBlockSet(blockerUid);
    return Array.from(set);
  }

  //********************************************************************
  //
  // blockUser Method
  //
  // Creates a Block record (social, user-visible) and also creates a
  // SafetyExclusion (internal, persistent) to enforce the block even
  // after account deletion and re-signup. SafetyExclusion persists
  // across account deletion by design.
  //
  // Return Value
  // ------------
  // Promise<Block>    Created block entity
  //
  // Value Parameters
  // ----------------
  // blockerUid    string    Firebase UID of user who is blocking
  // blockedUid    string    Firebase UID of user who is being blocked
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // blocker       User|null            Blocker user entity
  // blocked       User|null            Blocked user entity
  // existing      Block|null           Existing block record
  // block         Block                Block entity to create
  // blockerSafety SafetyIdentity|null  Blocker's safety identity
  // blockedSafety SafetyIdentity|null  Blocked user's safety identity
  // exclusion     SafetyExclusion|null Existing safety exclusion
  //
  //*******************************************************************
  async blockUser(blockerUid: string, blockedUid: string): Promise<Block> {
    if (blockerUid === blockedUid) {
      throw new BadRequestException("You cannot block yourself");
    }

    const blocker = await this.usersRepo.findOne({
      where: { uid: blockerUid, deletedAt: IsNull() },
    });
    const blocked = await this.usersRepo.findOne({
      where: { uid: blockedUid, deletedAt: IsNull() },
    });

    if (!blocker || !blocked) {
      throw new NotFoundException("User not found");
    }

    // Check for existing block (idempotent)
    const existing = await this.blockRepo.findOne({
      where: { blockerUid, blockedUid },
    });

    if (existing) {
      return existing; // Already blocked
    }

    // Create Block record (social, user-visible)
    const block = this.blockRepo.create({
      blockerUid,
      blockedUid,
    });
    await this.blockRepo.save(block);
    // Invalidate swipe/search queues for both users
    await this.redis.safe(() => this.redis.delete(`queue:${blockerUid}`), {
      op: "delete",
      key: `queue:${blockerUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${blockedUid}`), {
      op: "delete",
      key: `queue:${blockedUid}`,
    });

    await this.redis.bumpCacheVersion(blockerUid);
    await this.redis.bumpCacheVersion(blockedUid);
    await this.invalidateBlockCache([blockerUid, blockedUid]);
    await this.invalidateExclusionCache([blockerUid, blockedUid]);

    // ALSO create SafetyExclusion for persistent enforcement
    // SafetyExclusion persists across account deletion by design
    const blockerSafety = blocker.safetyIdentityId
      ? await this.safetyRepo.findOne({
          where: { id: blocker.safetyIdentityId },
        })
      : null;
    const blockedSafety = blocked.safetyIdentityId
      ? await this.safetyRepo.findOne({
          where: { id: blocked.safetyIdentityId },
        })
      : null;

    if (blockerSafety && blockedSafety) {
      // Check for existing exclusion (idempotent)
      const exclusion = await this.safetyExclusionRepo.findOne({
        where: {
          sourceSafetyIdentityId: blockerSafety.id,
          targetSafetyIdentityId: blockedSafety.id,
        },
      });

      if (!exclusion) {
        const newExclusion = this.safetyExclusionRepo.create({
          sourceSafetyIdentityId: blockerSafety.id,
          targetSafetyIdentityId: blockedSafety.id,
          reason: "user_block",
        });
        await this.safetyExclusionRepo.save(newExclusion);
      }
    }

    return block;
  }

  // Returns set of UIDs that are blocked (either direction) for the given user.
  async getBlockSet(uid: string): Promise<Set<string>> {
    const version = await this.redis.getCacheVersion(uid);
    const cacheKey = this.blockCacheKey(uid, version);
    const cachedMembers = await this.redis.safe(
      () => this.redis.client.sMembers(cacheKey),
      { op: "sMembers", key: cacheKey },
    );
    if (cachedMembers && cachedMembers.length > 0) {
      return new Set(this.filterSentinel(cachedMembers));
    }

    const blocks = await this.blockRepo.find({
      where: [{ blockerUid: uid }, { blockedUid: uid }],
    });

    const set = new Set<string>();
    blocks.forEach((b) => {
      if (b.blockerUid === uid) {
        set.add(b.blockedUid);
      } else {
        set.add(b.blockerUid);
      }
    });

    const valuesToStore =
      set.size === 0 ? [this.emptySentinel] : Array.from(set);

    await this.redis.safe(
      () => this.redis.client.sAdd(cacheKey, valuesToStore),
      { op: "sAdd", key: cacheKey },
    );
    await this.redis.safe(
      () => this.redis.client.expire(cacheKey, this.blockCacheTtlSeconds),
      { op: "expire", key: cacheKey, ttlSeconds: this.blockCacheTtlSeconds },
    );

    return set;
  }

  // Returns a set of UIDs that are safety-excluded relative to the given user.
  async getExclusionSet(uid: string): Promise<Set<string>> {
    const version = await this.redis.getCacheVersion(uid);
    const cacheKey = this.exclusionCacheKey(uid, version);
    const cachedMembers = await this.redis.safe(
      () => this.redis.client.sMembers(cacheKey),
      { op: "sMembers", key: cacheKey },
    );
    if (cachedMembers && cachedMembers.length > 0) {
      return new Set(this.filterSentinel(cachedMembers));
    }

    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user || !user.safetyIdentityId) {
      await this.redis.safe(
        () => this.redis.client.sAdd(cacheKey, this.emptySentinel),
        { op: "sAdd", key: cacheKey },
      );
      await this.redis.safe(
        () => this.redis.client.expire(cacheKey, this.exclusionCacheTtlSeconds),
        {
          op: "expire",
          key: cacheKey,
          ttlSeconds: this.exclusionCacheTtlSeconds,
        },
      );
      return new Set();
    }

    const safetyId = user.safetyIdentityId;

    const exclusions = await this.safetyExclusionRepo.find({
      where: [
        { sourceSafetyIdentityId: safetyId },
        { targetSafetyIdentityId: safetyId },
      ],
    });

    const otherSafetyIds = new Set<string>();
    exclusions.forEach((excl) => {
      if (excl.sourceSafetyIdentityId === safetyId) {
        otherSafetyIds.add(excl.targetSafetyIdentityId);
      } else if (excl.targetSafetyIdentityId === safetyId) {
        otherSafetyIds.add(excl.sourceSafetyIdentityId);
      }
    });

    if (otherSafetyIds.size === 0) {
      return new Set();
    }

    const users = await this.usersRepo.find({
      where: {
        safetyIdentityId: In(Array.from(otherSafetyIds)),
        deletedAt: IsNull(),
      },
    });

    const set = new Set(users.map((u) => u.uid));

    const valuesToStore =
      set.size === 0 ? [this.emptySentinel] : Array.from(set);

    await this.redis.safe(
      () => this.redis.client.sAdd(cacheKey, valuesToStore),
      { op: "sAdd", key: cacheKey },
    );
    await this.redis.safe(
      () => this.redis.client.expire(cacheKey, this.exclusionCacheTtlSeconds),
      {
        op: "expire",
        key: cacheKey,
        ttlSeconds: this.exclusionCacheTtlSeconds,
      },
    );

    return set;
  }

  //********************************************************************
  //
  // unblockUser Method
  //
  // Removes a Block record (social, user-visible) and also removes any
  // SafetyExclusion between the two users so unblocking fully lifts
  // safety enforcement.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // blockerUid    string    Firebase UID of user who is unblocking
  // blockedUid    string    Firebase UID of user who is being unblocked
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // block         Block|null           Block record to remove
  //
  //*******************************************************************
  async unblockUser(blockerUid: string, blockedUid: string): Promise<void> {
    const block = await this.blockRepo.findOne({
      where: { blockerUid, blockedUid },
    });

    if (block) {
      await this.blockRepo.remove(block);
    }

    // Remove safety exclusion in either direction, if both users have safety identities
    const [blocker, blocked] = await Promise.all([
      this.usersRepo.findOne({
        where: { uid: blockerUid, deletedAt: IsNull() },
      }),
      this.usersRepo.findOne({
        where: { uid: blockedUid, deletedAt: IsNull() },
      }),
    ]);

    if (blocker?.safetyIdentityId && blocked?.safetyIdentityId) {
      await this.safetyExclusionRepo.delete([
        {
          sourceSafetyIdentityId: blocker.safetyIdentityId,
          targetSafetyIdentityId: blocked.safetyIdentityId,
        },
        {
          sourceSafetyIdentityId: blocked.safetyIdentityId,
          targetSafetyIdentityId: blocker.safetyIdentityId,
        },
      ]);
    }

    // Invalidate swipe/search queues so cache respects unblock or lingering safety exclusion
    await this.redis.safe(() => this.redis.delete(`queue:${blockerUid}`), {
      op: "delete",
      key: `queue:${blockerUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${blockedUid}`), {
      op: "delete",
      key: `queue:${blockedUid}`,
    });

    await this.redis.bumpCacheVersion(blockerUid);
    await this.redis.bumpCacheVersion(blockedUid);
    await this.invalidateBlockCache([blockerUid, blockedUid]);
    await this.invalidateExclusionCache([blockerUid, blockedUid]);
  }

  //********************************************************************
  //
  // isExcluded Method
  //
  // Checks if a safety exclusion exists between two users' SafetyIdentities.
  // Used for silent enforcement - excluded users simply never appear and
  // cannot interact. This is internal-only and never exposed to users.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if exclusion exists, false otherwise
  //
  // Value Parameters
  // ----------------
  // sourceUid    string    Firebase UID of source user
  // targetUid    string    Firebase UID of target user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // source       User|null            Source user entity
  // target       User|null            Target user entity
  // sourceSafety SafetyIdentity|null  Source user's safety identity
  // targetSafety SafetyIdentity|null  Target user's safety identity
  // exclusion    SafetyExclusion|null Existing exclusion
  //
  //*******************************************************************
  async isExcluded(sourceUid: string, targetUid: string): Promise<boolean> {
    if (sourceUid === targetUid) {
      return false; // Users cannot exclude themselves
    }

    const source = await this.usersRepo.findOne({
      where: { uid: sourceUid, deletedAt: IsNull() },
    });
    const target = await this.usersRepo.findOne({
      where: { uid: targetUid, deletedAt: IsNull() },
    });

    if (
      !source ||
      !target ||
      !source.safetyIdentityId ||
      !target.safetyIdentityId
    ) {
      return false; // No exclusion if either user has no SafetyIdentity
    }

    const sourceSafety = await this.safetyRepo.findOne({
      where: { id: source.safetyIdentityId },
    });
    const targetSafety = await this.safetyRepo.findOne({
      where: { id: target.safetyIdentityId },
    });

    if (!sourceSafety || !targetSafety) {
      return false;
    }

    // Check for exclusion in either direction (bidirectional enforcement)
    const exclusion = await this.safetyExclusionRepo.findOne({
      where: [
        {
          sourceSafetyIdentityId: sourceSafety.id,
          targetSafetyIdentityId: targetSafety.id,
        },
        {
          sourceSafetyIdentityId: targetSafety.id,
          targetSafetyIdentityId: sourceSafety.id,
        },
      ],
    });

    return !!exclusion;
  }
}
