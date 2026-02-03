//********************************************************************
//
// SearchService Class
//
// Service for searching user profiles by name with distance filtering.
// Implements the same filtering rules as the swipe queue system to
// exclude already-liked profiles, matches, pending message requests,
// and profiles in hidden windows. Uses Haversine formula for distance
// calculations.
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
// HIDE_MS         number                    Hide window duration in milliseconds (30 days)
// profileRepo     Repository<Profile>       TypeORM repository for profiles
// userRepo        Repository<User>          TypeORM repository for users
// likeRepo        Repository<Like>          TypeORM repository for likes
// matchRepo       Repository<Match>         TypeORM repository for matches
// msgReqRepo      Repository<MessageRequest> TypeORM repository for message requests
// likes           LikeService               Like service
// matches         MatchesService            Matches service
// msgReqs         MessageRequestService     Message request service
// users           UsersService              Users service
//
//*******************************************************************

import { Injectable, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { createHash } from "crypto";

import { Profile } from "../database/entities/profile.entity";
import { User } from "../database/entities/user.entity";
import { Like } from "../database/entities/like.entity";
import { Match } from "../database/entities/match.entity";
import { MessageRequest } from "../database/entities/message-request.entity";

import { LikeService } from "../like/like.service";
import { MatchesService } from "../matches/matches.service";
import { MessageRequestService } from "../message-req/message-request.service";
import { UsersService } from "../users/users.service";
import { TokensService } from "../tokens/tokens.service";
import { BlocksService } from "../blocks/blocks.service";
import { RedisService } from "../redis/redis.service";
import { getAllDemoUids, isDemoUidStatic } from "../constants/review-config";

export interface ProfilePreview {
  id: string;
  name: string;
  age: number;
  bio: string;
  photoUrl: string | null;
  distanceMiles: number;
  userUid?: string;
}

@Injectable()
export class SearchService {
  private readonly HIDE_MS = 30 * 24 * 60 * 60 * 1000;
  private readonly searchCacheTtlSeconds = 45; // short TTL (soft cache)
  // Allow global env toggle to disable token purchase gates (e.g. for review/demo)
  private readonly paymentGatesEnabled =
    process.env.DISABLE_PAYMENT_GATES === "true" ||
    process.env.ENABLE_PAYMENTS === "false"
      ? false
      : true;

  constructor(
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Like)
    private readonly likeRepo: Repository<Like>,

    @InjectRepository(Match)
    private readonly matchRepo: Repository<Match>,

    @InjectRepository(MessageRequest)
    private readonly msgReqRepo: Repository<MessageRequest>,

    private readonly likes: LikeService,
    private readonly matches: MatchesService,
    private readonly msgReqs: MessageRequestService,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly blocksService: BlocksService,
    private readonly redis: RedisService,
  ) {}

  //********************************************************************
  //
  // calculateAge Function
  //
  // Calculates age from a birthday Date or ISO string.
  //
  // Return Value
  // ------------
  // number    Calculated age in years
  //
  // Value Parameters
  // ----------------
  // birthday    Date|string    Birthday date
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // b    Date    Birthday date object
  //
  //*******************************************************************
  private calculateAge(birthday: Date | string): number {
    const b = new Date(birthday);
    return new Date(Date.now() - b.getTime()).getUTCFullYear() - 1970;
  }

  //********************************************************************
  //
  // haversineMiles Function
  //
  // Calculates distance between two geographic coordinates using the
  // Haversine formula. Returns distance in miles.
  //
  // Return Value
  // ------------
  // number    Distance in miles
  //
  // Value Parameters
  // ----------------
  // lat1    number    Latitude of first point
  // lon1    number    Longitude of first point
  // lat2    number    Latitude of second point
  // lon2    number    Longitude of second point
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // R       number    Earth's radius in miles
  // toRad   Function  Function to convert degrees to radians
  // dLat    number    Difference in latitude in radians
  // dLon    number    Difference in longitude in radians
  // a       number    Haversine formula intermediate value
  //
  //*******************************************************************
  private haversineMiles(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 3958.8;
    const toRad = (n: number) => (n * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.asin(Math.sqrt(a));
  }

  //********************************************************************
  //
  // searchByName Method
  //
  // Searches profiles by name with distance filtering. Applies the same
  // filtering rules as the swipe queue system. Returns profiles sorted
  // by distance ascending.
  //
  // Return Value
  // ------------
  // Promise<ProfilePreview[]>    Array of profile preview objects
  //
  // Value Parameters
  // ----------------
  // uid          string    Firebase UID of searching user
  // name         string    Name to search for
  // radiusMiles  number    Maximum search radius in miles
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // meUser         User|null            Current user entity
  // meProfile      Profile|null         Current user's profile
  // now            Date                 Current timestamp
  // myLikes        Like[]               Likes sent by current user
  // likedSet       Set<string>          Set of UIDs the user has liked
  // likesTowardMe  Like[]               Likes received by current user
  // likedMeSet     Set<string>          Set of UIDs who liked the user
  // hiddenUntil    Map<string,Date>     Map of UIDs to hidden until dates
  // l              Like                 Like in loop
  // pending        MessageRequest[]     Pending message requests
  // pendingSet     Set<string>          Set of UIDs in pending requests
  // r              MessageRequest       Request in loop
  // other          string               Other user's UID
  // matches        Match[]              Matches involving the user
  // matchStatus    Map<string,string>   Map of UIDs to match status
  // m              Match                Match in loop
  // rawProfiles    Profile[]            Profiles matching the name
  // results        ProfilePreview[]     Final filtered results
  // p              Profile              Profile in loop
  // otherUid       string               Other user's UID
  // st             string|undefined     Match status
  // hide           Date|undefined       Hidden until date
  // u              User|null            Other user entity
  // distance       number               Calculated distance in miles
  //
  //*******************************************************************
  async searchByName(
    uid: string,
    name: string,
    radiusMiles: number,
  ): Promise<ProfilePreview[]> {
    const normalizedName = name.trim().toLowerCase();
    const roundedRadius = Math.round(radiusMiles || 0);
    const hash = createHash("sha1")
      .update(JSON.stringify({ name: normalizedName, radius: roundedRadius }))
      .digest("hex")
      .slice(0, 12);
    const cacheKey = `search:${uid}:${hash}`;

    const cached = await this.redis.safe(
      () => this.redis.getJson<ProfilePreview[]>(cacheKey),
      { op: "getJson", key: cacheKey },
    );
    if (cached) {
      return cached;
    }

    const meUser = await this.users.getByUid(uid);
    if (!meUser || meUser.latitude == null || meUser.longitude == null) {
      return [];
    }

    // Check payment flags before consuming tokens. Demo users are always exempt.
    const isDemoUser = isDemoUidStatic(uid);
    const paymentsEnabled = !isDemoUser && this.paymentGatesEnabled;

    if (paymentsEnabled) {
      const consumed = await this.tokens.consumeToken(meUser.id, "search");
      if (!consumed) {
        throw new ForbiddenException("insufficient search tokens");
      }
    }

    const meProfile = await this.profileRepo.findOne({
      where: { userUid: uid },
    });
    if (!meProfile) return [];

    const now = new Date();

    const [myLikes, likesTowardMe, blockSet, exclusionSet] = await Promise.all([
      this.likeRepo.find({ where: { swiperUid: uid } }),
      this.likeRepo.find({ where: { targetUid: uid } }),
      this.blocksService.getBlockSet(uid),
      this.blocksService.getExclusionSet(uid),
    ]);
    const likedSet = new Set(myLikes.map((l) => l.targetUid));
    const likedMeSet = new Set(likesTowardMe.map((l) => l.swiperUid));

    const hiddenUntil = new Map<string, Date>();
    for (const l of [...myLikes, ...likesTowardMe]) {
      if (l.hiddenUntil)
        hiddenUntil.set(l.targetUid ?? l.swiperUid, l.hiddenUntil);
    }

    const pending = await this.msgReqRepo.find({
      where: [
        { senderUid: uid, status: "pending" },
        { recipientUid: uid, status: "pending" },
      ],
    });

    const pendingSet = new Set<string>();
    for (const r of pending) {
      const other = r.senderUid === uid ? r.recipientUid : r.senderUid;
      pendingSet.add(other);
    }

    const demoUids = getAllDemoUids();
    const demoPeerUids = demoUids.filter((d) => d !== uid);
    if (isDemoUser && demoPeerUids.length === 0) {
      return [];
    }

    const matches = await this.matchRepo.find({
      where: [{ userAUid: uid }, { userBUid: uid }],
    });

    const matchStatus = new Map<string, string>();
    for (const m of matches) {
      const other = m.userAUid === uid ? m.userBUid : m.userAUid;
      matchStatus.set(other, m.status);
    }

    const rawProfiles = await this.profileRepo.find({
      where: { name: ILike(`%${normalizedName}%`) },
    });

    const candidateProfiles = rawProfiles.filter((p) => {
      if (isDemoUser) {
        return demoPeerUids.includes(p.userUid);
      }
      if (demoUids.length > 0 && demoUids.includes(p.userUid)) {
        return false;
      }
      return true;
    });

    const results: ProfilePreview[] = [];

    for (const p of candidateProfiles) {
      const otherUid = p.userUid;

      // Hard filter: SafetyExclusion (internal, persistent)
      if (exclusionSet.has(otherUid)) continue;
      if (blockSet.has(otherUid)) continue;
      if (otherUid === uid) continue;

      if (likedSet.has(otherUid)) {
        const st = matchStatus.get(otherUid);
        if (st !== "active" && st !== "restored") continue;
      }

      if (likedMeSet.has(otherUid) && !likedSet.has(otherUid)) {
        const st = matchStatus.get(otherUid);
        if (st !== "active" && st !== "restored") continue;
      }

      if (pendingSet.has(otherUid)) continue;

      const hide = hiddenUntil.get(otherUid);
      if (hide && hide > now) {
        const st = matchStatus.get(otherUid);
        if (st !== "active" && st !== "restored") continue;
      }

      if (matchStatus.get(otherUid) === "expired") continue;

      if (p.paused) continue;

      const u = await this.userRepo.findOne({ where: { uid: otherUid } });
      const isDemoPair = isDemoUser && isDemoUidStatic(otherUid);
      if (!isDemoPair && (!u || u.latitude == null || u.longitude == null))
        continue;

      const distance = isDemoPair
        ? 0
        : this.haversineMiles(
            meUser.latitude,
            meUser.longitude,
            (u?.latitude as number) ?? 0,
            (u?.longitude as number) ?? 0,
          );

      if (!isDemoPair && distance > roundedRadius) continue;

      results.push({
        id: p.id,
        name: p.name,
        age: this.calculateAge(p.birthday),
        bio: p.bio,
        photoUrl: p.photos?.[0] ?? null,
        distanceMiles: distance,
        userUid: otherUid,
      });
    }

    const sorted = results.sort((a, b) => a.distanceMiles - b.distanceMiles);

    await this.redis.safe(
      () => this.redis.setJson(cacheKey, sorted, this.searchCacheTtlSeconds),
      { op: "setJson", key: cacheKey, ttlSeconds: this.searchCacheTtlSeconds },
    );

    return sorted;
  }

  //********************************************************************
  //
  // searchByNameAdmin Method
  //
  // Admin version of searchByName that doesn't exclude the current user.
  // Used for admin dashboard to allow admins to search for and manage
  // their own accounts.
  //
  // Return Value
  // ------------
  // Promise<ProfilePreview[]>    Array of profile preview objects
  //
  // Value Parameters
  // ----------------
  // uid          string    Firebase UID of searching user (admin)
  // name         string    Name to search for
  // radiusMiles  number    Maximum search radius in miles (ignored for self)
  //
  //*******************************************************************
  async searchByNameAdmin(
    uid: string,
    name: string,
    radiusMiles: number,
  ): Promise<ProfilePreview[]> {
    const normalizedName = name.trim().toLowerCase();
    const roundedRadius = Math.round(radiusMiles || 0);
    const hash = createHash("sha1")
      .update(JSON.stringify({ name: normalizedName, radius: roundedRadius }))
      .digest("hex")
      .slice(0, 12);
    const cacheKey = `search:admin:${uid}:${hash}`;

    const cached = await this.redis.safe(
      () => this.redis.getJson<ProfilePreview[]>(cacheKey),
      { op: "getJson", key: cacheKey },
    );
    if (cached) {
      return cached;
    }

    const meUser = await this.users.getByUid(uid);
    if (!meUser || meUser.latitude == null || meUser.longitude == null) {
      return [];
    }

    const now = new Date();

    // Get all likes and matches for filtering (but don't exclude self)
    const [myLikes, likesTowardMe, blockSet, exclusionSet] = await Promise.all([
      this.likeRepo.find({ where: { swiperUid: uid } }),
      this.likeRepo.find({ where: { targetUid: uid } }),
      this.blocksService.getBlockSet(uid),
      this.blocksService.getExclusionSet(uid),
    ]);
    const likedSet = new Set(myLikes.map((l) => l.targetUid));

    const likedMeSet = new Set(likesTowardMe.map((l) => l.swiperUid));

    const hiddenUntil = new Map<string, Date>();
    for (const l of [...myLikes, ...likesTowardMe]) {
      if (l.hiddenUntil)
        hiddenUntil.set(l.targetUid ?? l.swiperUid, l.hiddenUntil);
    }

    const pending = await this.msgReqRepo.find({
      where: [
        { senderUid: uid, status: "pending" },
        { recipientUid: uid, status: "pending" },
      ],
    });

    const pendingSet = new Set<string>();
    for (const r of pending) {
      const other = r.senderUid === uid ? r.recipientUid : r.senderUid;
      pendingSet.add(other);
    }

    const matches = await this.matchRepo.find({
      where: [{ userAUid: uid }, { userBUid: uid }],
    });

    const matchStatus = new Map<string, string>();
    for (const m of matches) {
      const other = m.userAUid === uid ? m.userBUid : m.userAUid;
      matchStatus.set(other, m.status);
    }

    const rawProfiles = await this.profileRepo.find({
      where: { name: ILike(`%${normalizedName}%`) },
    });

    const results: ProfilePreview[] = [];

    for (const p of rawProfiles) {
      const otherUid = p.userUid;

      // Hard filter: SafetyExclusion (but allow self)
      if (otherUid !== uid && exclusionSet.has(otherUid)) continue;
      if (otherUid !== uid && blockSet.has(otherUid)) continue;

      // Skip filtering for self - admin can always find themselves
      if (otherUid === uid) {
        // Include own profile without filtering
      } else {
        // Apply normal filters for other users
        if (likedSet.has(otherUid)) {
          const st = matchStatus.get(otherUid);
          if (st !== "active" && st !== "restored") continue;
        }

        if (likedMeSet.has(otherUid) && !likedSet.has(otherUid)) {
          const st = matchStatus.get(otherUid);
          if (st !== "active" && st !== "restored") continue;
        }

        if (pendingSet.has(otherUid)) continue;

        const hide = hiddenUntil.get(otherUid);
        if (hide && hide > now) {
          const st = matchStatus.get(otherUid);
          if (st !== "active" && st !== "restored") continue;
        }

        if (matchStatus.get(otherUid) === "expired") continue;
      }

      if (p.paused && otherUid !== uid) continue; // Allow finding paused own profile

      const u = await this.userRepo.findOne({ where: { uid: otherUid } });
      if (!u) continue;

      // For self, use admin's location; for others, require location
      if (otherUid !== uid && (u.latitude == null || u.longitude == null))
        continue;

      const distance = this.haversineMiles(
        meUser.latitude,
        meUser.longitude,
        u.latitude ?? meUser.latitude,
        u.longitude ?? meUser.longitude,
      );

      if (distance > roundedRadius && otherUid !== uid) continue; // Allow finding self regardless of distance

      results.push({
        id: p.id,
        name: p.name,
        age: this.calculateAge(p.birthday),
        bio: p.bio,
        photoUrl: p.photos?.[0] ?? null,
        distanceMiles: distance,
        userUid: otherUid,
      });
    }

    const sorted = results.sort((a, b) => a.distanceMiles - b.distanceMiles);

    await this.redis.safe(
      () => this.redis.setJson(cacheKey, sorted, this.searchCacheTtlSeconds),
      {
        op: "setJson",
        key: cacheKey,
        ttlSeconds: this.searchCacheTtlSeconds,
      },
    );

    return sorted;
  }
}
