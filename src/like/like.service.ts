//********************************************************************
//
// LikeService Class
//
// Service for managing like/swipe actions. Handles like creation,
// mutual like detection, match creation, and hide window management.
// Implements 30-day TTL for likes and prevents likes when pending
// message requests exist.
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
// TTL_MS           number              Like TTL in milliseconds (30 days)
// likeRepo         Repository<Like>    TypeORM repository for likes
// msgReqRepo       Repository<MessageRequest> TypeORM repository for message requests
// matchesRepo      Repository<Match>   TypeORM repository for matches
// users            UsersService        Users service
// profiles         ProfilesService     Profiles service
// matchesService   MatchesService      Matches service
// redis            RedisService        Redis service for cache invalidation
//
//*******************************************************************

import { Injectable, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, MoreThan } from "typeorm";

import { Like } from "../database/entities/like.entity";
import { MessageRequest } from "../database/entities/message-request.entity";
import { Match } from "../database/entities/match.entity";
import { User } from "../database/entities/user.entity";

import { UsersService } from "../users/users.service";
import { ProfilesService } from "../profiles/profiles.service";
import { MatchesService } from "../matches/matches.service";
import { RedisService } from "../redis/redis.service";
import { TokensService } from "../tokens/tokens.service";
import { BlocksService } from "../blocks/blocks.service";
import { isDemoUidStatic } from "../constants/review-config";

@Injectable()
export class LikeService {
  private readonly TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  private readonly likeCacheTtlSeconds = 300; // 5 minutes for like sets
  private readonly hideCacheTtlSeconds = Math.ceil(this.TTL_MS / 1000); // align with hide window

  constructor(
    @InjectRepository(Like)
    private readonly likeRepo: Repository<Like>,

    @InjectRepository(MessageRequest)
    private readonly msgReqRepo: Repository<MessageRequest>,

    @InjectRepository(Match)
    private readonly matchesRepo: Repository<Match>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly matchesService: MatchesService,
    private readonly redis: RedisService,
    private readonly tokens: TokensService,
    private readonly blocksService: BlocksService,
  ) {}

  private sentLikesKey(uid: string) {
    return `likes:sent:${uid}`;
  }

  private receivedLikesKey(uid: string) {
    return `likes:received:${uid}`;
  }

  private hideWindowKey(uid: string) {
    return `likes:hide:${uid}`;
  }

  private async cacheLike(
    swiperUid: string,
    targetUid: string,
    hiddenUntil: Date,
  ) {
    await Promise.all([
      this.redis.safe(
        () => this.redis.client.sAdd(this.sentLikesKey(swiperUid), targetUid),
        { op: "sAdd", key: this.sentLikesKey(swiperUid) },
      ),
      this.redis.safe(
        () =>
          this.redis.client.sAdd(this.receivedLikesKey(targetUid), swiperUid),
        { op: "sAdd", key: this.receivedLikesKey(targetUid) },
      ),
      this.redis.safe(
        () =>
          this.redis.client.zAdd(this.hideWindowKey(swiperUid), {
            score: hiddenUntil.getTime(),
            value: targetUid,
          }),
        { op: "zAdd", key: this.hideWindowKey(swiperUid) },
      ),
    ]);

    await Promise.all([
      this.redis.safe(
        () =>
          this.redis.client.expire(
            this.sentLikesKey(swiperUid),
            this.likeCacheTtlSeconds,
          ),
        { op: "expire", key: this.sentLikesKey(swiperUid) },
      ),
      this.redis.safe(
        () =>
          this.redis.client.expire(
            this.receivedLikesKey(targetUid),
            this.likeCacheTtlSeconds,
          ),
        { op: "expire", key: this.receivedLikesKey(targetUid) },
      ),
      this.redis.safe(
        () =>
          this.redis.client.expire(
            this.hideWindowKey(swiperUid),
            this.hideCacheTtlSeconds,
          ),
        { op: "expire", key: this.hideWindowKey(swiperUid) },
      ),
    ]);
  }

  private async invalidateLikeCaches(uids: string[]) {
    const tasks: Promise<unknown>[] = [];
    for (const uid of uids) {
      tasks.push(
        this.redis.safe(() => this.redis.delete(this.sentLikesKey(uid)), {
          op: "delete",
          key: this.sentLikesKey(uid),
        }),
        this.redis.safe(() => this.redis.delete(this.receivedLikesKey(uid)), {
          op: "delete",
          key: this.receivedLikesKey(uid),
        }),
        this.redis.safe(() => this.redis.delete(this.hideWindowKey(uid)), {
          op: "delete",
          key: this.hideWindowKey(uid),
        }),
      );
    }
    await Promise.all(tasks);
  }

  async getSentLikes(uid: string): Promise<Set<string>> {
    const key = this.sentLikesKey(uid);
    const members = await this.redis.safe(
      () => this.redis.client.sMembers(key),
      { op: "sMembers", key },
    );
    if (!members || members.length === 0) {
      const likes = await this.likeRepo.find({
        where: { swiperUid: uid, liked: true, expiresAt: MoreThan(new Date()) },
      });
      const targets = likes.map((l) => l.targetUid);
      if (targets.length > 0) {
        await this.redis.safe(() => this.redis.client.sAdd(key, targets), {
          op: "sAdd",
          key,
        });
        await this.redis.safe(
          () => this.redis.client.expire(key, this.likeCacheTtlSeconds),
          {
            op: "expire",
            key,
          },
        );
      }
      return new Set(targets);
    }
    await this.redis.safe(
      () => this.redis.client.expire(key, this.likeCacheTtlSeconds),
      { op: "expire", key },
    );
    return new Set(members);
  }

  async getHideWindows(uid: string): Promise<Map<string, Date>> {
    const key = this.hideWindowKey(uid);
    // Remove expired entries
    const now = Date.now();
    await this.redis.safe(
      () => this.redis.client.zRemRangeByScore(key, 0, now),
      { op: "zRemRangeByScore", key },
    );
    const entries = await this.redis.safe(
      () => this.redis.client.zRangeWithScores(key, 0, -1),
      { op: "zRangeWithScores", key },
    );
    if (entries && entries.length > 0) {
      await this.redis.safe(
        () => this.redis.client.expire(key, this.hideCacheTtlSeconds),
        { op: "expire", key },
      );
      return new Map(entries.map((e) => [e.value, new Date(e.score)]));
    }

    const likes = await this.likeRepo.find({
      where: { swiperUid: uid, liked: true, expiresAt: MoreThan(new Date()) },
    });
    if (likes.length === 0) return new Map();
    const payload = likes
      .filter((l) => l.hiddenUntil)
      .map((l) => ({
        value: l.targetUid,
        score: l.hiddenUntil?.getTime() ?? now,
      }));
    if (payload.length > 0) {
      await this.redis.safe(() => this.redis.client.zAdd(key, payload), {
        op: "zAdd",
        key,
      });
      await this.redis.safe(
        () => this.redis.client.expire(key, this.hideCacheTtlSeconds),
        { op: "expire", key },
      );
    }
    return new Map(payload.map((p) => [p.value, new Date(p.score)]));
  }

  //********************************************************************
  //
  // likeUser Method
  //
  // Main like function. Creates a like record, checks for mutual likes,
  // and creates or revives matches. Prevents likes when pending message
  // requests exist. Invalidates Redis queues for both users.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with match status and matchId
  //
  // Value Parameters
  // ----------------
  // swiperUid    string    Firebase UID of the user performing the like
  // targetUid    string    Firebase UID of the user being liked
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // targetProfile    ProfileResponse|null    Target user's profile
  // pendingReq       MessageRequest|null     Pending message request
  // now              Date                    Current timestamp
  // expiresAt        Date                    Like expiration date
  // like             Like                    Created like entity
  // mutual           Like|null               Mutual like record
  // existingMatch    Match|null              Existing match record
  // revived          Match                   Revived match entity
  // newMatch         Match                   Newly created match entity
  //
  //*******************************************************************
  async likeUser(swiperUid: string, targetUid: string) {
    if (swiperUid === targetUid) {
      return { match: false, error: "cannot like yourself" };
    }

    const swiperIsDemo = isDemoUidStatic(swiperUid);
    const targetIsDemo = isDemoUidStatic(targetUid);
    if (swiperIsDemo !== targetIsDemo) {
      return { match: false, error: "user not available" };
    }

    // Blocked/excluded users cannot be liked
    const isBlocked = await this.blocksService.isExcluded(swiperUid, targetUid);
    if (isBlocked) {
      return { match: false, error: "user not available" };
    }

    // Prevent excessive like spam: limit 100 likes per rolling day
    const likeCountKey = `like:count:${swiperUid}:${new Date()
      .toISOString()
      .slice(0, 10)}`;
    const incremented = await this.redis.safe(
      () => this.redis.increment(likeCountKey),
      { op: "incr", key: likeCountKey },
    );
    if (incremented !== null && incremented === 1) {
      // set TTL 24h when first created
      await this.redis.safe(
        () => this.redis.set(likeCountKey, String(incremented), 24 * 60 * 60),
        { op: "expire", key: likeCountKey },
      );
    }
    if (incremented !== null && incremented > 100) {
      throw new BadRequestException("Like rate limit exceeded");
    }

    await this.users.ensureUserExists(swiperUid, null, null);
    await this.users.ensureUserExists(targetUid, null, null);

    const swiper = await this.userRepo.findOne({ where: { uid: swiperUid } });
    if (!swiper) {
      return { match: false, error: "user not found" };
    }

    // Likes are free - no token consumption

    const targetProfile = await this.profiles.getProfile(targetUid);
    if (!targetProfile) {
      return { match: false, error: "target user has no profile" };
    }

    const pendingReq = await this.msgReqRepo.findOne({
      where: [
        { senderUid: swiperUid, recipientUid: targetUid, status: "pending" },
        { senderUid: targetUid, recipientUid: swiperUid, status: "pending" },
      ],
    });

    if (pendingReq) {
      return { match: false, error: "pending message request blocks likes" };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.TTL_MS);

    await this.likeRepo.delete({ swiperUid, targetUid });

    const like = this.likeRepo.create({
      swiperUid,
      targetUid,
      liked: true,
      createdAt: now,
      expiresAt,
      hiddenUntil: expiresAt,
      isHidden: false,
    });

    await this.likeRepo.save(like);

    await this.cacheLike(swiperUid, targetUid, expiresAt);
    await this.redis.safe(() => this.redis.delete(`queue:${swiperUid}`), {
      op: "delete",
      key: `queue:${swiperUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${targetUid}`), {
      op: "delete",
      key: `queue:${targetUid}`,
    });

    const mutual = await this.likeRepo.findOne({
      where: {
        swiperUid: targetUid,
        targetUid: swiperUid,
        liked: true,
        expiresAt: MoreThan(now),
      },
    });

    if (!mutual) {
      return { match: false };
    }

    const existingMatch = await this.matchesRepo.findOne({
      where: [
        { userAUid: swiperUid, userBUid: targetUid },
        { userAUid: targetUid, userBUid: swiperUid },
      ],
    });

    if (existingMatch && existingMatch.status === "expired") {
      const revived = await this.matchesService.reviveMatch(existingMatch);

      await this.likeRepo.update(
        { swiperUid, targetUid },
        { hiddenUntil: null },
      );
      await this.likeRepo.update(
        { swiperUid: targetUid, targetUid: swiperUid },
        { hiddenUntil: null },
      );

      await this.redis.safe(() => this.redis.delete(`queue:${swiperUid}`), {
        op: "delete",
        key: `queue:${swiperUid}`,
      });
      await this.redis.safe(() => this.redis.delete(`queue:${targetUid}`), {
        op: "delete",
        key: `queue:${targetUid}`,
      });

      return { match: true, matchId: revived.id };
    }

    if (
      existingMatch &&
      (existingMatch.status === "active" || existingMatch.status === "restored")
    ) {
      await this.likeRepo.update(
        { swiperUid, targetUid },
        { hiddenUntil: null },
      );
      await this.likeRepo.update(
        { swiperUid: targetUid, targetUid: swiperUid },
        { hiddenUntil: null },
      );

      await this.redis.safe(() => this.redis.delete(`queue:${swiperUid}`), {
        op: "delete",
        key: `queue:${swiperUid}`,
      });
      await this.redis.safe(() => this.redis.delete(`queue:${targetUid}`), {
        op: "delete",
        key: `queue:${targetUid}`,
      });

      return { match: true, matchId: existingMatch.id };
    }

    const newMatch = await this.matchesService.createMatch(
      swiperUid,
      targetUid,
    );

    await this.likeRepo.update({ swiperUid, targetUid }, { hiddenUntil: null });
    await this.likeRepo.update(
      { swiperUid: targetUid, targetUid: swiperUid },
      { hiddenUntil: null },
    );

    await this.redis.safe(() => this.redis.delete(`queue:${swiperUid}`), {
      op: "delete",
      key: `queue:${swiperUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${targetUid}`), {
      op: "delete",
      key: `queue:${targetUid}`,
    });

    return { match: true, matchId: newMatch.id };
  }

  //********************************************************************
  //
  // getUsersILiked Method
  //
  // Gets all users that the specified user has liked (non-expired,
  // non-hidden likes).
  //
  // Return Value
  // ------------
  // Promise<Like[]>    Array of like entities
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
  async getUsersILiked(uid: string) {
    return this.likeRepo.find({
      where: {
        swiperUid: uid,
        expiresAt: MoreThan(new Date()),
        isHidden: false,
      },
    });
  }

  //********************************************************************
  //
  // getUsersWhoLikedMe Method
  //
  // Gets all users who have liked the specified user (non-expired,
  // non-hidden likes).
  //
  // Return Value
  // ------------
  // Promise<Like[]>    Array of like entities
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
  async getUsersWhoLikedMe(uid: string) {
    return this.likeRepo.find({
      where: {
        targetUid: uid,
        expiresAt: MoreThan(new Date()),
        isHidden: false,
      },
    });
  }

  //********************************************************************
  //
  // isWithinHideWindow Method
  //
  // Checks if a hide window is active between two users (uidA has
  // liked uidB and hide window hasn't expired).
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if hide window is active
  //
  // Value Parameters
  // ----------------
  // uidA    string    Firebase UID of first user
  // uidB    string    Firebase UID of second user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // like    Like|null    Like record with active hide window
  //
  //*******************************************************************
  async isWithinHideWindow(uidA: string, uidB: string): Promise<boolean> {
    const like = await this.likeRepo.findOne({
      where: {
        swiperUid: uidA,
        targetUid: uidB,
        hiddenUntil: MoreThan(new Date()),
      },
    });

    return !!like;
  }

  //********************************************************************
  //
  // haveMutualLike Method
  //
  // Checks if two users have a mutual like (both have non-expired likes
  // for each other).
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if mutual like exists
  //
  // Value Parameters
  // ----------------
  // uidA    string    Firebase UID of first user
  // uidB    string    Firebase UID of second user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // now     Date        Current timestamp
  // aLikesB Like|null   Like from uidA to uidB
  // bLikesA Like|null   Like from uidB to uidA
  //
  //*******************************************************************
  async haveMutualLike(uidA: string, uidB: string): Promise<boolean> {
    const now = new Date();

    const aLikesB = await this.likeRepo.findOne({
      where: { swiperUid: uidA, targetUid: uidB, expiresAt: MoreThan(now) },
    });

    if (!aLikesB) return false;

    const bLikesA = await this.likeRepo.findOne({
      where: { swiperUid: uidB, targetUid: uidA, expiresAt: MoreThan(now) },
    });

    return !!bLikesA;
  }
}
