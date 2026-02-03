//********************************************************************
//
// ProfilesService Class
//
// Service for managing user profiles. Handles profile CRUD operations,
// swipe queue generation with complex filtering rules, photo management,
// location updates, and profile pause/unpause. Implements distance-based
// matching with compatibility filtering. S3 is used for photo storage.
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
// profilesRepo    Repository<Profile>         TypeORM repository for profiles
// likeRepo        Repository<Like>            TypeORM repository for likes
// matchRepo       Repository<Match>           TypeORM repository for matches
// msgReqRepo      Repository<MessageRequest>  TypeORM repository for message requests
// usersService    UsersService                Users service for user operations
// s3              S3Service                   S3 service for photo storage
// redis           RedisService                Redis service for caching
//
//*******************************************************************

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In, IsNull } from "typeorm";

import { Profile } from "../database/entities/profile.entity";
import { Like } from "../database/entities/like.entity";
import { Match } from "../database/entities/match.entity";
import { MessageRequest } from "../database/entities/message-request.entity";
import { ProfilePhoto } from "../database/entities/profile-photo.entity";

import { UsersService } from "../users/users.service";
import { S3Service } from "../s3/s3.service";
import { RedisService } from "../redis/redis.service";
import { BlocksService } from "../blocks/blocks.service";

import { SetupProfileDto } from "./dto/setup-profile.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { computeCompatibilityScore } from "../utils/compatibility";
import { normalizeArray } from "../utils/array-normalize";
import { ModerationQueueService } from "../moderation/moderation-queue.service";
import { getAllDemoUids, isDemoUidStatic } from "../constants/review-config";

export interface ProfileResponse extends Omit<Profile, "user"> {
  profileImageUrl: string | null;
  age: number;
  distance?: number; // Distance in miles (only for queue responses)
}

type PreferenceSubject = {
  prefRace?: string[] | null;
  prefReligion?: string[] | null;
  prefPolitics?: string[] | null;
  prefEducation?: string[] | null;
  prefActivityLevel?: string | null;
  prefDrinking?: string[] | null;
  prefSmoking?: string[] | null;
  prefMarijuana?: string[] | null;
  race?: string[] | null;
  religion?: string[] | null;
  politics?: string[] | null;
  education?: string[] | null;
  activityLevel?: string | null;
  drinking?: string[] | null;
  smoking?: string[] | null;
  marijuana?: string[] | null;
};

const MIN_AGE = 18;
const MAX_AGE = 99;
const MAX_DISTANCE_MILES = 500;
const MAX_PHOTOS = 6;
const MAX_ARRAY_ENTRIES = 30;
const S3_URL_PATTERN = /amazonaws\.com\/([^?]+)/;
const SCHOOL_DOMAIN_MAP: Record<string, string> = {
  "missouristate.edu": "Missouri State University",
  "drury.edu": "Drury University",
  "evangel.edu": "Evangel University",
  "otc.edu": "Ozarks Technical College",
  "mission.edu": "Mission University",
  "sbuniv.edu": "Southern Baptist University",
};
const REQUIRE_SCHOOL_EMAIL_GATE =
  process.env.REQUIRE_SCHOOL_EMAIL_GATE === "true";

type QueueEntry = {
  userUid: string;
  distance: number;
  score: number;
};

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);
  private readonly profileCacheTtlSeconds = 300; // 5 minutes
  private readonly photoStatusCacheTtlSeconds = 300; // 5 minutes
  private readonly queueHydrateLimit = 30; // Only hydrate top N queue entries

  private toError(err: unknown): Error {
    if (err instanceof Error) return err;
    if (typeof err === "string") return new Error(err);
    try {
      return new Error(JSON.stringify(err));
    } catch {
      return new Error("Unknown error");
    }
  }

  private normalizePhotoKey(key: string): string | null {
    if (!key) return null;
    if (key.startsWith("http")) {
      try {
        const parsed = new URL(key);
        const match = parsed.href.match(S3_URL_PATTERN);
        if (match && match[1]) {
          return match[1].replace(/^\//, "");
        }
        return parsed.pathname.replace(/^\//, "");
      } catch {
        return null;
      }
    }
    return key.replace(/^\//, "");
  }

  private normalizePhotoKeyArray(values: string[]): string[] {
    return values
      .map((k) => this.normalizePhotoKey(k))
      .filter((k): k is string => Boolean(k));
  }

  private validateName(uid: string, name: string): void {
    if (isDemoUidStatic(uid)) return;
    if (/\d/.test(name)) {
      throw new BadRequestException("Name cannot contain numbers");
    }
  }

  private deriveSchoolFromEmail(email?: string | null): string | null {
    if (!email) return null;
    const domain = email.includes("@")
      ? email.split("@")[1]?.toLowerCase()
      : null;
    if (!domain) return null;
    const match = Object.keys(SCHOOL_DOMAIN_MAP).find(
      (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
    );
    return match ? SCHOOL_DOMAIN_MAP[match] : null;
  }

  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,

    @InjectRepository(Like)
    private readonly likeRepo: Repository<Like>,

    @InjectRepository(Match)
    private readonly matchRepo: Repository<Match>,

    @InjectRepository(MessageRequest)
    private readonly msgReqRepo: Repository<MessageRequest>,

    @InjectRepository(ProfilePhoto)
    private readonly photoRepo: Repository<ProfilePhoto>,

    private readonly usersService: UsersService,
    private readonly s3: S3Service,
    private readonly redis: RedisService,
    private readonly blocksService: BlocksService,
    private readonly moderationQueue: ModerationQueueService,
  ) {}

  private profileCacheKey(
    uid: string,
    scope: "owner" | "public",
    version: number,
  ) {
    return `profile:${scope}:v${version}:${uid}`;
  }

  private photoStatusCacheKey(uid: string) {
    return `photo:status:${uid}`;
  }

  private async getCachedProfileResponse(
    uid: string,
    scope: "owner" | "public",
  ): Promise<ProfileResponse | null> {
    const version = await this.redis.getCacheVersion(uid);
    const key = this.profileCacheKey(uid, scope, version);
    const cached = await this.redis.safe(
      () => this.redis.getJson<ProfileResponse>(key),
      { op: "getJson", key },
    );
    return cached ? this.hydrateProfileDates(cached) : null;
  }

  private async setCachedProfileResponse(
    uid: string,
    scope: "owner" | "public",
    value: ProfileResponse,
  ) {
    const version = await this.redis.getCacheVersion(uid);
    const key = this.profileCacheKey(uid, scope, version);
    await this.redis.safe(
      () => this.redis.setJson(key, value, this.profileCacheTtlSeconds),
      { op: "setJson", key, ttlSeconds: this.profileCacheTtlSeconds },
    );
  }

  private async getPhotoStatusMap(
    userUid: string,
  ): Promise<Map<string, string>> {
    const cacheKey = this.photoStatusCacheKey(userUid);

    const cached = await this.redis.safe(
      () =>
        this.redis.getJson<Array<{ url: string; status: string }>>(cacheKey),
      { op: "getJson", key: cacheKey },
    );
    if (cached) {
      return new Map(cached.map((p) => [p.url, p.status]));
    }

    const photoStatuses = await this.photoRepo.find({
      where: {
        userId: userUid,
      },
    });

    const payload = photoStatuses.map((p) => ({
      url: p.url,
      status: p.status,
    }));

    await this.redis.safe(
      () =>
        this.redis.setJson(cacheKey, payload, this.photoStatusCacheTtlSeconds),
      {
        op: "setJson",
        key: cacheKey,
        ttlSeconds: this.photoStatusCacheTtlSeconds,
      },
    );

    return new Map(payload.map((p) => [p.url, p.status]));
  }

  private async hydrateQueueEntries(
    entries: QueueEntry[],
    viewerUid: string,
    preloadedProfiles?: Map<string, Profile>,
  ): Promise<ProfileResponse[]> {
    const slice = entries.slice(0, this.queueHydrateLimit);
    const profileMap = new Map<string, Profile>();

    if (preloadedProfiles) {
      preloadedProfiles.forEach((value, key) => profileMap.set(key, value));
    }

    const missingUids = slice
      .map((e) => e.userUid)
      .filter((uid) => !profileMap.has(uid));

    if (missingUids.length > 0) {
      const found = await this.profilesRepo.find({
        where: { userUid: In(missingUids), deletedAt: IsNull() },
      });
      found.forEach((p) => profileMap.set(p.userUid, p));
    }

    const hydrated: ProfileResponse[] = [];
    for (const entry of slice) {
      const profile = profileMap.get(entry.userUid);
      if (!profile) continue;
      const full = await this.toResponse(profile, viewerUid);
      full.distance = entry.distance;
      hydrated.push(full);
    }

    return hydrated;
  }

  private async invalidateProfileCache(uid: string) {
    const version = await this.redis.getCacheVersion(uid);
    const keys = [
      this.profileCacheKey(uid, "owner", version),
      this.profileCacheKey(uid, "public", version),
    ];
    await Promise.all(
      keys.map((key) =>
        this.redis.safe(() => this.redis.delete(key), { op: "delete", key }),
      ),
    );
  }

  private hydrateProfileDates(response: ProfileResponse): ProfileResponse {
    const toDate = (value: unknown) =>
      typeof value === "string" ? new Date(value) : (value as Date);

    return {
      ...response,
      birthday: toDate(response.birthday),
      createdAt: response.createdAt
        ? toDate(response.createdAt)
        : response.createdAt,
      updatedAt: response.updatedAt
        ? toDate(response.updatedAt)
        : response.updatedAt,
      deletedAt: response.deletedAt
        ? toDate(response.deletedAt)
        : response.deletedAt,
    };
  }

  private normalizeBirthdayValue(
    birthday: Profile["birthday"],
    profileId: string,
  ): Date {
    if (birthday instanceof Date && !isNaN(birthday.getTime())) {
      return birthday;
    }

    if (typeof birthday === "string") {
      const parsed = new Date(birthday);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      this.logger.error("INVALID_PROFILE_BIRTHDAY", {
        profileId,
        birthday,
      });
      return new Date("2000-01-01");
    }

    this.logger.error("INVALID_PROFILE_BIRTHDAY", {
      profileId,
      birthday,
    });
    return new Date("2000-01-01");
  }

  private hasSoftPreferences(profile: PreferenceSubject): boolean {
    return Boolean(
      (profile.prefRace && profile.prefRace.length > 0) ||
      (profile.prefReligion && profile.prefReligion.length > 0) ||
      (profile.prefPolitics && profile.prefPolitics.length > 0) ||
      (profile.prefEducation && profile.prefEducation.length > 0) ||
      profile.prefActivityLevel ||
      (profile.prefDrinking && profile.prefDrinking.length > 0) ||
      (profile.prefSmoking && profile.prefSmoking.length > 0) ||
      (profile.prefMarijuana && profile.prefMarijuana.length > 0),
    );
  }

  private preferenceMatchScore(
    me: PreferenceSubject,
    other: PreferenceSubject,
  ): { score: number; matches: number } {
    let score = 0;
    let matches = 0;

    const addArrayMatch = (
      pref: string[] | null | undefined,
      value: string[] | null | undefined,
      weight: number,
    ) => {
      if (pref && pref.length > 0 && value && value.length > 0) {
        const overlap = pref.some((p) => value.includes(p));
        if (overlap) {
          score += weight;
          matches += 1;
        }
      }
    };

    addArrayMatch(me.prefRace, other.race, 8);
    addArrayMatch(me.prefReligion, other.religion, 6);
    addArrayMatch(me.prefPolitics, other.politics, 6);
    addArrayMatch(me.prefEducation, other.education, 6);
    addArrayMatch(me.prefDrinking, other.drinking, 4);
    addArrayMatch(me.prefSmoking, other.smoking, 4);
    addArrayMatch(me.prefMarijuana, other.marijuana, 3);

    if (me.prefActivityLevel && other.activityLevel) {
      if (me.prefActivityLevel === other.activityLevel) {
        score += 5;
        matches += 1;
      }
    }

    return { score, matches };
  }

  //********************************************************************
  //
  // calculateAge Function
  //
  // Calculates age from a birthday ISO string.
  //
  // Return Value
  // ------------
  // number    Calculated age in years
  //
  // Value Parameters
  // ----------------
  // birthday    string    ISO date string
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // b       Date        Birthday date object
  // diff    number      Time difference in milliseconds
  //
  //*******************************************************************
  private calculateAge(birthday: Date): number {
    const time = birthday.getTime();
    if (isNaN(time)) return 0;

    const diff = Date.now() - time;
    if (diff < 0) return 0; // Future date protection

    return new Date(diff).getUTCFullYear() - 1970;
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
  // toResponse Function
  //
  // Converts a Profile entity to ProfileResponse format, adding
  // profileImageUrl (first photo) and calculated age.
  //
  // Return Value
  // ------------
  // ProfileResponse    Profile response object
  //
  // Value Parameters
  // ----------------
  // profile    Profile    Profile entity to convert
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
  async toResponse(
    profile: Profile,
    viewerUid: string | null = null,
  ): Promise<ProfileResponse> {
    // ---- DEFENSIVE NORMALIZATION ----

    // Birthday normalization (cannot allow Invalid Date to escape)
    let birthday: Date;
    if (
      profile.birthday instanceof Date &&
      !isNaN(profile.birthday.getTime())
    ) {
      // Already a valid Date → use as-is
      birthday = profile.birthday;
    } else if (typeof profile.birthday === "string") {
      // TypeORM sometimes returns DATE as string (YYYY-MM-DD) → convert to Date
      const parsed = new Date(profile.birthday);
      if (!isNaN(parsed.getTime())) {
        birthday = parsed;
      } else {
        // String exists but cannot be parsed → log and fallback
        this.logger.error("INVALID_PROFILE_BIRTHDAY", {
          profileId: profile.id,
          birthday: profile.birthday,
        });
        birthday = new Date("2000-01-01"); // safe fallback
      }
    } else {
      // Null, undefined, or other invalid type → log and fallback
      this.logger.error("INVALID_PROFILE_BIRTHDAY", {
        profileId: profile.id,
        birthday: profile.birthday,
      });
      birthday = new Date("2000-01-01"); // safe fallback
    }

    // Get approved photos (or all photos if owner is viewing)
    const isOwner = viewerUid === profile.userUid;
    const photoKeys: string[] = Array.isArray(profile.photos)
      ? this.normalizePhotoKeyArray(profile.photos)
      : [];
    const originalKeys: (string | null)[] = Array.isArray(
      profile.photoOriginals,
    )
      ? (profile.photoOriginals as unknown[]).map((k) =>
          typeof k === "string" ? this.normalizePhotoKey(k) : null,
        )
      : photoKeys;

    const normalizePhotoKey = (key: string): string | null => {
      if (!key) return null;
      if (key.startsWith("http")) {
        try {
          const parsed = new URL(key);
          const match = parsed.href.match(S3_URL_PATTERN);
          if (match && match[1]) {
            return match[1].replace(/^\//, "");
          }
          return parsed.pathname.replace(/^\//, "");
        } catch {
          return null;
        }
      }
      // If key already looks like "uploads/...", keep as-is
      return key.replace(/^\//, "");
    };

    const photoEntries: Array<{
      derived: { original: string; normalized: string | null };
      original: { original: string; normalized: string | null };
    }> = photoKeys.map((k, idx) => {
      const originalKey = originalKeys[idx] ?? k;
      return {
        derived: {
          original: k,
          normalized: normalizePhotoKey(k),
        },
        original: {
          original: originalKey,
          normalized: normalizePhotoKey(originalKey),
        },
      };
    });

    // Get moderation status for each photo (cached by user)
    const statusMap = await this.getPhotoStatusMap(profile.userUid);

    const getStatus = (entry: {
      normalized: string | null;
      original: string;
    }) => {
      const statusKey = entry.normalized || entry.original;
      return statusKey ? statusMap.get(statusKey) || "pending" : "pending";
    };

    const hasApproved = photoEntries.some(
      (entry) => getStatus(entry.derived) === "approved",
    );

    // Filter photos by status:
    // - Owner: anything except rejected
    // - Public queue: approved only; if none approved yet, allow pending as a temporary fallback (hide flagged/rejected)
    const visiblePhotoEntries = photoEntries.filter((entry) => {
      const status = getStatus(entry.derived);
      if (isOwner) {
        return status !== "rejected"; // Owner can see pending/approved/flagged
      }
      if (status === "approved") return true;
      if (!hasApproved && status === "pending") {
        return true;
      }
      return false;
    });

    // Convert visible photo keys to presigned GET URLs
    const photoUrls: (string | null)[] = await Promise.all(
      visiblePhotoEntries.map(async (entry): Promise<string | null> => {
        if (!entry.derived.normalized) return null;
        try {
          const url: string = await this.s3.createReadUrl(
            entry.derived.normalized,
          );
          return url;
        } catch (err: unknown) {
          const msg = this.toError(err);
          this.logger.warn(
            `Failed to generate read URL for photo key: ${entry.derived.original}`,
            msg.message,
          );
          // Fallback: if the stored value was already a full https URL, return it as-is
          if (entry.derived.original?.startsWith("http")) {
            return entry.derived.original;
          }
          return null;
        }
      }),
    );

    const originalUrls: (string | null)[] = await Promise.all(
      visiblePhotoEntries.map(async (entry): Promise<string | null> => {
        if (!entry.original.normalized) return null;
        try {
          const url: string = await this.s3.createReadUrl(
            entry.original.normalized,
          );
          return url;
        } catch (err: unknown) {
          const msg = this.toError(err);
          this.logger.warn(
            `Failed to generate read URL for original photo key: ${entry.original.original}`,
            msg.message,
          );
          if (entry.original.original?.startsWith("http")) {
            return entry.original.original;
          }
          return null;
        }
      }),
    );
    const validPhotoUrls: string[] = photoUrls.filter(
      (url): url is string => url !== null,
    );
    const validOriginalUrls: string[] = originalUrls.filter(
      (url): url is string => url !== null,
    );
    const profileImageUrl: string | null = validPhotoUrls[0] ?? null;

    // ---- RESPONSE ----
    return {
      id: profile.id,
      userUid: profile.userUid,
      name: profile.name,
      birthday,
      bio: profile.bio ?? "",
      sex: profile.sex,
      sexPreference: profile.sexPreference,
      datingPreference: profile.datingPreference,
      interests: Array.isArray(profile.interests) ? profile.interests : [],
      photos: validPhotoUrls,
      photoOriginals: validOriginalUrls,
      paused: !!profile.paused,
      height: profile.height ?? [],
      race: profile.race ?? [],
      religion: profile.religion ?? [],
      politics: profile.politics ?? [],
      education: profile.education ?? [],
      activityLevel: profile.activityLevel ?? null,
      drinking: profile.drinking ?? [],
      smoking: profile.smoking ?? [],
      marijuana: profile.marijuana ?? [],
      prefMinAge: profile.prefMinAge ?? null,
      prefMaxAge: profile.prefMaxAge ?? null,
      prefMinDistanceMiles: profile.prefMinDistanceMiles ?? null,
      prefMaxDistanceMiles: profile.prefMaxDistanceMiles ?? null,
      prefMinHeight: profile.prefMinHeight ?? null,
      prefMaxHeight: profile.prefMaxHeight ?? null,
      prefRace: profile.prefRace ?? null,
      prefReligion: profile.prefReligion ?? null,
      prefPolitics: profile.prefPolitics ?? null,
      prefEducation: profile.prefEducation ?? null,
      prefActivityLevel: profile.prefActivityLevel ?? null,
      prefDrinking: profile.prefDrinking ?? null,
      prefSmoking: profile.prefSmoking ?? null,
      prefMarijuana: profile.prefMarijuana ?? null,
      showOutsideRange: !!profile.showOutsideRange,
      expandAge: !!profile.expandAge,
      expandDistance: !!profile.expandDistance,
      expandHeight: !!profile.expandHeight,
      school: profile.school ?? null,
      gradYear: profile.gradYear ?? null,
      major: profile.major ?? null,
      deletedAt: profile.deletedAt ?? null,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      profileImageUrl,
      age: this.calculateAge(birthday),
    };
  }

  //********************************************************************
  //
  // getProfile Method
  //
  // Retrieves a user's profile by Firebase UID. Returns null if not found.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse | null>    Profile response or null
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
  // p    Profile|null    Profile entity from database
  //
  //*******************************************************************
  async getProfile(uid: string): Promise<ProfileResponse | null> {
    const cached = await this.getCachedProfileResponse(uid, "owner");
    if (cached) return cached;

    const p = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });
    if (!p) return null; // Owner viewing own profile

    const response = await this.toResponse(p, uid);
    await this.setCachedProfileResponse(uid, "owner", response);
    return response;
  }

  //********************************************************************
  //
  // checkStatus Method
  //
  // Checks if a user has a completed profile. Returns status object
  // with "complete" or "missing".
  //
  // Return Value
  // ------------
  // Promise<{ status: string }>    Status object
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
  async checkStatus(uid: string) {
    return { status: (await this.getProfile(uid)) ? "complete" : "missing" };
  }

  //********************************************************************
  //
  // getSwipeQueue Method
  //
  // Generates a swipe queue of profiles following strict filtering rules.
  // Implements hard exclusion filters and soft preference-based sorting.
  // No swipe/like limits. Queue is deterministic and stable until depleted.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse[]>    Array of profile responses sorted by compatibility
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID of the requesting user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // cached          ProfileResponse[]|null    Cached queue from Redis
  // me              ProfileResponse|null      Current user's profile
  // meUser          User|null                 Current user entity
  // myLat           number                    Current user's latitude
  // myLng           number                    Current user's longitude
  // now             Date                      Current timestamp
  // myLikes         Like[]                    Likes sent by current user
  // likedSet        Set<string>               Set of UIDs the user has liked
  // hiddenUntilMap  Map<string,Date>          Map of UIDs to hidden until dates
  // matches         Match[]                   Matches involving the user
  // matchStatus     Map<string,string>        Map of UIDs to match status
  // blocks          Block[]                   Blocks involving the user
  // blockedSet      Set<string>               Set of blocked UIDs
  // candidates      Profile[]                 All candidate profiles
  // passedHard      ProfileResponse[]         Profiles that passed hard filters
  // relaxed         boolean                   Whether to relax soft preferences
  //
  //*******************************************************************
  async getSwipeQueue(uid: string): Promise<ProfileResponse[]> {
    const me = await this.getProfile(uid);
    if (!me) return [];
    const hasSoftPrefs = this.hasSoftPreferences(me);

    const demoUids = getAllDemoUids();
    const isDemoUser = isDemoUidStatic(uid);
    const demoPeerUids = demoUids.filter((d) => d !== uid);
    if (isDemoUser && demoPeerUids.length === 0) {
      return [];
    }

    const meUser = await this.usersService.getByUid(uid);
    const myLat = meUser?.latitude ?? 0;
    const myLng = meUser?.longitude ?? 0;

    const now = new Date();

    const [blockSet, exclusionSet]: [Set<string>, Set<string>] =
      await Promise.all([
        this.blocksService.getBlockSet(uid),
        this.blocksService.getExclusionSet(uid),
      ]);

    // Get likes sent by user
    const myLikes = await this.likeRepo.find({ where: { swiperUid: uid } });
    const likedSet = new Set(myLikes.map((l) => l.targetUid));

    // Build hidden until map (for skip cooldown/hide window)
    const hiddenUntilMap = new Map<string, Date>();
    myLikes.forEach((l) => {
      if (l.hiddenUntil && l.hiddenUntil > now) {
        hiddenUntilMap.set(l.targetUid, l.hiddenUntil);
      }
    });

    // Get matches to check for restored status
    const matches = await this.matchRepo.find({
      where: [{ userAUid: uid }, { userBUid: uid }],
    });
    const matchStatus = new Map<string, string>();
    matches.forEach((m) => {
      const other = m.userAUid === uid ? m.userBUid : m.userAUid;
      matchStatus.set(other, m.status);
    });

    // Step 1: Apply sex/preference filtering (STRICT RULES)
    // Case A: User selects male -> show only male profiles where profile.sexPreference includes user's sex
    // Case B: User selects female -> show only female profiles where profile.sexPreference includes user's sex
    // Case C: User selects everyone -> show profiles where profile.sexPreference includes user's sex
    let sexFilter: string;
    if (me.sexPreference === "male") {
      sexFilter = `p.sex = 'male' AND (p.sexPreference = 'everyone' OR p.sexPreference = :mySex)`;
    } else if (me.sexPreference === "female") {
      sexFilter = `p.sex = 'female' AND (p.sexPreference = 'everyone' OR p.sexPreference = :mySex)`;
    } else {
      // everyone
      sexFilter = `(p.sexPreference = 'everyone' OR p.sexPreference = :mySex)`;
    }

    // Also ensure the candidate's preference includes the user's sex
    const qb = this.profilesRepo
      .createQueryBuilder("p")
      .leftJoinAndSelect("p.user", "u")
      .where("p.userUid != :uid", { uid })
      .andWhere("p.paused = false")
      .andWhere("p.sex IS NOT NULL")
      .andWhere("p.deletedAt IS NULL")
      .andWhere("u.deletedAt IS NULL")
      .andWhere(sexFilter, { mySex: me.sex })
      .orderBy("p.createdAt", "DESC");

    if (isDemoUser) {
      qb.andWhere("p.userUid IN (:...demoPeerUids)", { demoPeerUids });
    } else if (demoUids.length > 0) {
      qb.andWhere("p.userUid NOT IN (:...demoUids)", { demoUids });
    }

    const candidates = await qb.getMany();

    // Step 2: Apply HARD EXCLUSION FILTERS
    const passedHard: Array<{
      profile: Profile;
      distance: number;
    }> = [];

    for (const p of candidates) {
      const other = p.userUid;
      const otherIsDemo = isDemoUidStatic(other);
      const isDemoPair = isDemoUser && otherIsDemo;

      // Hard filter: Blocked (social, user-visible)
      if (blockSet.has(other)) continue;

      // Hard filter: SafetyExclusion (internal, persistent)
      // SafetyExclusion persists across account deletion by design
      // Excluded users simply never appear - enforcement is silent
      if (exclusionSet.has(other)) continue;

      // Hard filter: Already matched (exclude all matches from queue)
      const matchSt = matchStatus.get(other);
      if (matchSt === "active" || matchSt === "restored") {
        // Exclude active/restored matches from queue - they should only appear in matches/messages screens
        continue;
      }

      // Hard filter: Already liked (unless restored)
      if (likedSet.has(other)) {
        continue;
      }

      // Hard filter: Hidden via skip cooldown/hide window (unless restored)
      const hidden = hiddenUntilMap.get(other);
      if (hidden) {
        const st = matchStatus.get(other);
        if (st !== "active" && st !== "restored") continue;
      }

      // Hard filter: Expired match
      if (matchStatus.get(other) === "expired") continue;

      // Hard filter: Age outside range
      const birthday = this.normalizeBirthdayValue(p.birthday, p.id);
      const otherAge = this.calculateAge(birthday);
      const minAge = me.prefMinAge ?? 18;
      const maxAge = me.prefMaxAge ?? 60;
      if (!me.expandAge && !me.showOutsideRange) {
        if (otherAge < minAge || otherAge > maxAge) continue;
      }

      // Hard filter: Race preference strict match when specified
      if (me.prefRace && me.prefRace.length > 0) {
        if (!p.race || p.race.length === 0) continue;
        const raceMatch = me.prefRace.some((r) => p.race.includes(r));
        if (!raceMatch) continue;
      }

      // Calculate distance
      const otherLat = p.user?.latitude;
      const otherLng = p.user?.longitude;
      let distance = isDemoPair ? 0 : 999;
      if (!isDemoPair) {
        if (
          myLat &&
          myLng &&
          otherLat != null &&
          otherLng != null &&
          !isNaN(myLat) &&
          !isNaN(myLng) &&
          !isNaN(otherLat) &&
          !isNaN(otherLng) &&
          myLat !== 0 &&
          myLng !== 0 &&
          otherLat !== 0 &&
          otherLng !== 0
        ) {
          distance = Number(
            this.haversineMiles(myLat, myLng, otherLat, otherLng).toFixed(1),
          );
        }

        // Hard filter: Distance outside max distance
        const maxDistance = me.prefMaxDistanceMiles ?? 50;
        if (!me.expandDistance && !me.showOutsideRange) {
          if (distance !== 999 && distance > maxDistance) continue;
        }
      }

      // Hard filter: Height outside range (use preference filter, not user's own height)
      if (
        me.prefMinHeight != null &&
        me.prefMaxHeight != null &&
        p.height &&
        p.height.length > 0
      ) {
        // Convert profile's height string (e.g., "5'6\"") to inches
        const heightInches = this.parseHeightToInches(p.height[0]);
        if (heightInches == null) continue; // Skip if height can't be parsed

        // Check if height is within preference range
        if (!me.expandHeight && !me.showOutsideRange) {
          if (
            heightInches < me.prefMinHeight ||
            heightInches > me.prefMaxHeight
          ) {
            continue;
          }
        }
      }

      // Soft preference gate: if user configured prefs and showOutsideRange=false, require at least one match
      const prefMatch = this.preferenceMatchScore(me, p);
      if (!me.showOutsideRange && hasSoftPrefs && prefMatch.matches === 0) {
        continue;
      }

      passedHard.push({ profile: p, distance });
    }

    const allowAgeExpansion = me.showOutsideRange || me.expandAge;
    const allowDistanceExpansion = me.showOutsideRange || me.expandDistance;
    const allowHeightExpansion = me.showOutsideRange || me.expandHeight;
    const allowAnyExpansion =
      allowAgeExpansion || allowDistanceExpansion || allowHeightExpansion;

    // Step 3: If queue is empty and expansion is enabled, relax soft preferences only
    // Re-run with relaxed soft preferences (race, religion, politics, education, drinking, smoking, marijuana, activityLevel)
    // but keep ALL hard filters (age, distance, height, sex compatibility, mutual interest) unless specific dimension is expanded.
    if (passedHard.length === 0 && allowAnyExpansion) {
      // Re-process candidates but skip soft preference checks
      for (const p of candidates) {
        const other = p.userUid;

        // Apply all hard filters again
        // Hard filter: Blocked (social, user-visible)
        if (blockSet.has(other)) continue;

        // Hard filter: SafetyExclusion (internal, persistent)
        // SafetyExclusion persists across account deletion by design
        if (exclusionSet.has(other)) continue;
        if (likedSet.has(other)) {
          const st = matchStatus.get(other);
          if (st !== "active" && st !== "restored") continue;
        }
        const hidden = hiddenUntilMap.get(other);
        if (hidden) {
          const st = matchStatus.get(other);
          if (st !== "active" && st !== "restored") continue;
        }
        if (matchStatus.get(other) === "expired") continue;

        const birthday = this.normalizeBirthdayValue(p.birthday, p.id);
        const otherAge = this.calculateAge(birthday);
        const minAge = me.prefMinAge ?? 18;
        const maxAge = me.prefMaxAge ?? 60;
        if (!allowAgeExpansion && (otherAge < minAge || otherAge > maxAge)) {
          continue;
        }

        const otherLat = p.user?.latitude;
        const otherLng = p.user?.longitude;
        const otherIsDemo = isDemoUidStatic(other);
        const isDemoPair = isDemoUser && otherIsDemo;
        let distance = isDemoPair ? 0 : 999;
        if (!isDemoPair) {
          if (
            myLat &&
            myLng &&
            otherLat != null &&
            otherLng != null &&
            !isNaN(myLat) &&
            !isNaN(myLng) &&
            !isNaN(otherLat) &&
            !isNaN(otherLng) &&
            myLat !== 0 &&
            myLng !== 0 &&
            otherLat !== 0 &&
            otherLng !== 0
          ) {
            distance = Number(
              this.haversineMiles(myLat, myLng, otherLat, otherLng).toFixed(1),
            );
          }

          const maxDistance = me.prefMaxDistanceMiles ?? 50;
          if (
            !allowDistanceExpansion &&
            distance !== 999 &&
            distance > maxDistance
          ) {
            continue;
          }
        }

        // Hard filter: Height outside range (use preference filter, not user's own height)
        if (
          me.prefMinHeight != null &&
          me.prefMaxHeight != null &&
          p.height &&
          p.height.length > 0
        ) {
          // Convert profile's height string (e.g., "5'6\"") to inches
          const heightInches = this.parseHeightToInches(p.height[0]);
          if (heightInches == null) continue; // Skip if height can't be parsed

          // Check if height is within preference range unless height expansion is allowed
          if (
            !allowHeightExpansion &&
            (heightInches < me.prefMinHeight || heightInches > me.prefMaxHeight)
          ) {
            continue;
          }
        }

        // Skip soft preference checks (race, religion, politics, education, drinking, smoking, marijuana, activityLevel)
        // These are now only used for sorting, not filtering

        passedHard.push({ profile: p, distance });
      }
    }

    // Step 4: SOFT SORTING (not filtering) by compatibility
    const withScores = passedHard.map(({ profile, distance }) => {
      const p = profile;

      // Calculate shared interests
      const myInterests = me.interests || [];
      const theirInterests = p.interests || [];
      const sharedInterests = myInterests.filter((i) =>
        theirInterests.includes(i),
      );

      // Calculate compatibility score
      const baseScore = computeCompatibilityScore({
        mySex: me.sex,
        theirSex: p.sex,
        myPreference: me.sexPreference,
        theirPreference: p.sexPreference,
        distanceMiles: distance === 999 ? 1000 : distance,
        sharedInterests,
        myDatingPreference: me.datingPreference,
        theirDatingPreference: p.datingPreference,
      });

      const prefScore = this.preferenceMatchScore(me, p).score;
      const score = baseScore + prefScore;

      return { profile, score, distance };
    });

    // Sort by compatibility score (highest first), then by distance (closest first), then by profile ID (deterministic)
    withScores.sort((a, b) => {
      // Primary: compatibility score (descending)
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // Secondary: distance (ascending - closer is better)
      const aDist = a.distance ?? 999;
      const bDist = b.distance ?? 999;
      if (aDist !== bDist) {
        return aDist - bDist;
      }
      // Tertiary: profile ID (ascending - deterministic tie-breaker)
      return a.profile.id.localeCompare(b.profile.id);
    });

    const queueEntries: QueueEntry[] = withScores.map(
      ({ profile, distance, score }) => ({
        userUid: profile.userUid,
        distance,
        score,
      }),
    );

    const top = withScores.slice(0, this.queueHydrateLimit);
    const preloaded = new Map<string, Profile>(
      top.map(({ profile }) => [profile.userUid, profile]),
    );

    const hydrated = await this.hydrateQueueEntries(
      queueEntries,
      uid,
      preloaded,
    );

    return hydrated;
  }

  //********************************************************************
  //
  // createUploadUrl Method
  //
  // Creates an S3 pre-signed URL for uploading photos. Also returns
  // a presigned read URL so the frontend can immediately display the photo.
  //
  // Return Value
  // ------------
  // Promise<Object>    Object containing uploadUrl, key, and readUrl
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
  // uploadResult    Object    Result from S3Service.createUploadUrl
  // readUrl         string    Presigned GET URL for the uploaded photo
  //
  //*******************************************************************
  async createUploadUrl(): Promise<{
    uploadUrlOriginal: string;
    keyOriginal: string;
    readUrlOriginal: string;
    uploadUrlDerived: string;
    keyDerived: string;
    readUrlDerived: string;
    // Backwards compatibility fields (mirror derived)
    uploadUrl: string;
    key: string;
    readUrl: string;
  }> {
    const original = await this.s3.createUploadUrl();
    const derived = await this.s3.createUploadUrl();

    const readUrlOriginal: string = await this.s3.createReadUrl(original.key);
    const readUrlDerived: string = await this.s3.createReadUrl(derived.key);

    return {
      uploadUrlOriginal: original.uploadUrl,
      keyOriginal: original.key,
      readUrlOriginal,
      uploadUrlDerived: derived.uploadUrl,
      keyDerived: derived.key,
      readUrlDerived,
      // legacy fields
      uploadUrl: derived.uploadUrl,
      key: derived.key,
      readUrl: readUrlDerived,
    };
  }

  //********************************************************************
  //
  // createDerivedUploadUrl Method
  //
  // Returns a new presigned upload/read URL pair for a derived photo.
  // Used when re-cropping an existing photo so the original key can be reused.
  //
  //********************************************************************
  async createDerivedUploadUrl(originalKey?: string): Promise<{
    uploadUrl: string;
    key: string;
    readUrl: string;
    originalKey?: string;
  }> {
    const normalizePhotoKey = (key: string): string | null => {
      if (!key) return null;
      if (key.startsWith("http")) {
        try {
          const parsed = new URL(key);
          const match = parsed.href.match(S3_URL_PATTERN);
          if (match && match[1]) {
            return match[1].replace(/^\//, "");
          }
          return parsed.pathname.replace(/^\//, "");
        } catch {
          return null;
        }
      }
      return key.replace(/^\//, "");
    };

    const normalizedOriginal = originalKey
      ? normalizePhotoKey(originalKey)
      : undefined;

    const derived = await this.s3.createUploadUrl();
    const readUrl: string = await this.s3.createReadUrl(derived.key);
    return {
      uploadUrl: derived.uploadUrl,
      key: derived.key,
      readUrl,
      originalKey: normalizedOriginal || originalKey,
    };
  }

  //********************************************************************
  //
  // setup Method
  //
  // Creates or updates a user's profile during onboarding. Ensures
  // user exists, creates profile if missing, or updates existing profile.
  // Invalidates Redis queue cache.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Created or updated profile response
  //
  // Value Parameters
  // ----------------
  // uid    string            Firebase UID
  // dto    SetupProfileDto   Profile setup data
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // profile    Profile|null    Existing profile or null
  //
  //*******************************************************************
  async setup(uid: string, dto: SetupProfileDto): Promise<ProfileResponse> {
    await this.usersService.ensureUserExists(uid, null, null);
    this.validateName(uid, dto.name);
    if (REQUIRE_SCHOOL_EMAIL_GATE) {
      const user = await this.usersService.getByUid(uid);
      const derivedSchool = this.deriveSchoolFromEmail(user?.email ?? null);
      if (!user?.schoolEmailVerified || !derivedSchool) {
        throw new BadRequestException(
          "Verified school email required to continue onboarding",
        );
      }
    }

    // Convert height object to string array
    const heightArray: string[] = [`${dto.height.feet}'${dto.height.inches}"`];

    // Convert birthday object to Date
    const year = Number(dto.birthday.year);
    const month = Number(dto.birthday.month);
    const day = Number(dto.birthday.day);

    const birthdayDate = new Date(year, month, day);
    if (Number.isNaN(birthdayDate.getTime())) {
      throw new BadRequestException("Invalid birthday");
    }

    let profile = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });
    if (!profile) {
      profile = this.profilesRepo.create({ userUid: uid });
    }

    profile.name = dto.name;
    profile.birthday = birthdayDate;
    profile.bio = dto.bio;
    profile.sex = dto.sex;
    profile.sexPreference = dto.sexPreference;
    profile.datingPreference = dto.datingPreference;
    profile.interests = normalizeArray<string>(dto.interests);
    profile.photos = this.normalizePhotoKeyArray(
      normalizeArray<string>(dto.photos),
    );
    const originalPhotos = this.normalizePhotoKeyArray(
      normalizeArray<string>(dto.photoOriginals ?? dto.photos),
    );
    profile.photoOriginals = originalPhotos;

    // Create ProfilePhoto records for all photos during setup
    for (let i = 0; i < dto.photos.length; i++) {
      const photoKey = dto.photos[i];
      const originalKey = originalPhotos[i] ?? photoKey;
      const photoRecord = this.photoRepo.create({
        userId: uid,
        url: photoKey,
        derivedKey: photoKey,
        originalKey,
        status: "pending",
      });
      await this.photoRepo.save(photoRecord);
      // Enqueue for moderation
      await this.moderationQueue.enqueuePhoto(photoRecord.id, photoKey);
    }

    profile.height = heightArray;
    profile.race = normalizeArray(dto.race);
    profile.religion = normalizeArray(dto.religion);
    profile.politics = normalizeArray(dto.politics);
    profile.education = normalizeArray(dto.education);
    if (dto.activityLevel !== undefined)
      profile.activityLevel = dto.activityLevel;
    profile.drinking = normalizeArray(dto.drinking);
    profile.smoking = normalizeArray(dto.smoking);
    profile.marijuana = normalizeArray(dto.marijuana);
    if (dto.prefMinAge !== undefined) profile.prefMinAge = dto.prefMinAge;
    if (dto.prefMaxAge !== undefined) profile.prefMaxAge = dto.prefMaxAge;
    if (dto.prefMinDistanceMiles !== undefined)
      profile.prefMinDistanceMiles = dto.prefMinDistanceMiles;
    if (dto.prefMaxDistanceMiles !== undefined)
      profile.prefMaxDistanceMiles = dto.prefMaxDistanceMiles;
    if (dto.showOutsideRange !== undefined)
      profile.showOutsideRange = dto.showOutsideRange;
    if (dto.expandAge !== undefined) profile.expandAge = dto.expandAge;
    if (dto.expandDistance !== undefined)
      profile.expandDistance = dto.expandDistance;
    if (dto.expandHeight !== undefined) profile.expandHeight = dto.expandHeight;

    const saved = await this.profilesRepo.save(profile);

    await this.redis.bumpCacheVersion(uid);
    await this.invalidateProfileCache(uid);
    return await this.toResponse(saved, uid);
  }

  //********************************************************************
  //
  // updateProfile Method
  //
  // Updates a user's profile with partial data. Throws NotFoundException
  // if profile doesn't exist. Invalidates Redis queue cache.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
  //
  // Value Parameters
  // ----------------
  // uid    string            Firebase UID
  // data   Partial<Profile>  Partial profile data to update
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // p      Profile|null    Profile entity from database
  // saved  Profile         Saved profile entity
  //
  //*******************************************************************
  async updateProfile(uid: string, data: UpdateProfileDto) {
    const p = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });
    if (!p) throw new NotFoundException("Profile not found");

    const validateNumberRange = (
      value: number,
      min: number,
      max: number,
      field: string,
    ) => {
      if (value < min || value > max) {
        throw new BadRequestException(
          `${field} must be between ${min} and ${max}`,
        );
      }
    };

    const validateArrayLength = (
      arr: unknown[] | undefined,
      field: string,
      maxLen: number = MAX_ARRAY_ENTRIES,
    ) => {
      if (arr && arr.length > maxLen) {
        throw new BadRequestException(
          `${field} exceeds maximum of ${maxLen} entries`,
        );
      }
    };

    const previousPhotos = Array.isArray(p.photos) ? [...p.photos] : [];

    let nextPhotos: string[] | null = null;
    let nextPhotoOriginals: string[] | null = null;

    if ("bio" in data && data.bio !== undefined) p.bio = data.bio;
    if ("sexPreference" in data && data.sexPreference !== undefined)
      p.sexPreference = data.sexPreference;
    if ("datingPreference" in data && data.datingPreference !== undefined)
      p.datingPreference = data.datingPreference;
    if ("interests" in data && data.interests !== undefined) {
      validateArrayLength(data.interests, "interests");
      p.interests = normalizeArray<string>(data.interests);
    }
    if ("photos" in data && data.photos !== undefined) {
      validateArrayLength(data.photos, "photos", MAX_PHOTOS);
      nextPhotos = this.normalizePhotoKeyArray(
        normalizeArray<string>(data.photos),
      );
    }
    if ("photoOriginals" in data && data.photoOriginals !== undefined) {
      validateArrayLength(data.photoOriginals, "photoOriginals", MAX_PHOTOS);
      nextPhotoOriginals = this.normalizePhotoKeyArray(
        normalizeArray<string>(data.photoOriginals),
      );
    }
    if ("height" in data && data.height !== undefined) {
      p.height = [`${data.height.feet}'${data.height.inches}"`];
    }
    if ("race" in data && data.race !== undefined) {
      validateArrayLength(data.race, "race");
      p.race = normalizeArray(data.race);
    }
    if ("religion" in data && data.religion !== undefined) {
      validateArrayLength(data.religion, "religion");
      p.religion = normalizeArray(data.religion);
    }
    if ("politics" in data && data.politics !== undefined) {
      validateArrayLength(data.politics, "politics");
      p.politics = normalizeArray(data.politics);
    }
    if ("education" in data && data.education !== undefined) {
      validateArrayLength(data.education, "education");
      p.education = normalizeArray(data.education);
    }
    if ("activityLevel" in data && data.activityLevel !== undefined)
      p.activityLevel = data.activityLevel;
    if ("drinking" in data && data.drinking !== undefined) {
      validateArrayLength(data.drinking, "drinking");
      p.drinking = normalizeArray(data.drinking);
    }
    if ("smoking" in data && data.smoking !== undefined) {
      validateArrayLength(data.smoking, "smoking");
      p.smoking = normalizeArray(data.smoking);
    }
    if ("marijuana" in data && data.marijuana !== undefined) {
      validateArrayLength(data.marijuana, "marijuana");
      p.marijuana = normalizeArray(data.marijuana);
    }

    // Single source of truth: derive school from verified email domain.
    const user = await this.usersService.getByUid(uid);
    const derivedSchool = this.deriveSchoolFromEmail(user?.email ?? null);

    if (derivedSchool) {
      p.school = derivedSchool;
    }
    if ("major" in data) {
      const normalizedMajor = data.major?.trim();
      p.major = normalizedMajor ? normalizedMajor : null;
    }
    if ("gradYear" in data) {
      p.gradYear =
        data.gradYear === null ||
        data.gradYear === undefined ||
        Number.isNaN(data.gradYear)
          ? null
          : data.gradYear;
    }

    if (nextPhotos) {
      // Ensure originals array stays aligned with derived photos
      if (!nextPhotoOriginals) {
        nextPhotoOriginals = [...nextPhotos];
      }
      if (nextPhotoOriginals.length < nextPhotos.length) {
        // Pad missing originals with derived keys to keep indexes aligned
        const padded = [...nextPhotoOriginals];
        while (padded.length < nextPhotos.length) {
          padded.push(nextPhotos[padded.length]);
        }
        nextPhotoOriginals = padded;
      }
      if (nextPhotoOriginals.length > nextPhotos.length) {
        nextPhotoOriginals = nextPhotoOriginals.slice(0, nextPhotos.length);
      }

      p.photos = nextPhotos;
      p.photoOriginals = nextPhotoOriginals;

      // Create moderation records for any newly added derived photos
      const existing = new Set(previousPhotos);
      for (let i = 0; i < nextPhotos.length; i++) {
        const derivedKey = nextPhotos[i];
        if (existing.has(derivedKey)) continue;
        const originalKey =
          nextPhotoOriginals && nextPhotoOriginals[i]
            ? nextPhotoOriginals[i]
            : derivedKey;
        const photoRecord = this.photoRepo.create({
          userId: uid,
          url: derivedKey,
          derivedKey,
          originalKey,
          status: "pending",
        });
        await this.photoRepo.save(photoRecord);
        await this.moderationQueue.enqueuePhoto(photoRecord.id, derivedKey);
      }
    } else if (nextPhotoOriginals) {
      p.photoOriginals = nextPhotoOriginals;
    }
    if ("prefMinAge" in data && data.prefMinAge !== undefined) {
      validateNumberRange(data.prefMinAge, MIN_AGE, MAX_AGE, "prefMinAge");
      p.prefMinAge = data.prefMinAge;
    }
    if ("prefMaxAge" in data && data.prefMaxAge !== undefined) {
      validateNumberRange(data.prefMaxAge, MIN_AGE, MAX_AGE, "prefMaxAge");
      p.prefMaxAge = data.prefMaxAge;
    }
    if (
      p.prefMinAge !== null &&
      p.prefMaxAge !== null &&
      p.prefMinAge !== undefined &&
      p.prefMaxAge !== undefined &&
      p.prefMinAge > p.prefMaxAge
    ) {
      throw new BadRequestException("prefMinAge cannot exceed prefMaxAge");
    }
    if (
      "prefMinDistanceMiles" in data &&
      data.prefMinDistanceMiles !== undefined
    ) {
      validateNumberRange(
        data.prefMinDistanceMiles,
        0,
        MAX_DISTANCE_MILES,
        "prefMinDistanceMiles",
      );
      p.prefMinDistanceMiles = data.prefMinDistanceMiles;
    }
    if (
      "prefMaxDistanceMiles" in data &&
      data.prefMaxDistanceMiles !== undefined
    ) {
      validateNumberRange(
        data.prefMaxDistanceMiles,
        0,
        MAX_DISTANCE_MILES,
        "prefMaxDistanceMiles",
      );
      p.prefMaxDistanceMiles = data.prefMaxDistanceMiles;
    }
    if (
      p.prefMinDistanceMiles !== null &&
      p.prefMaxDistanceMiles !== null &&
      p.prefMinDistanceMiles !== undefined &&
      p.prefMaxDistanceMiles !== undefined &&
      p.prefMinDistanceMiles > p.prefMaxDistanceMiles
    ) {
      throw new BadRequestException(
        "prefMinDistanceMiles cannot exceed prefMaxDistanceMiles",
      );
    }
    if ("showOutsideRange" in data && data.showOutsideRange !== undefined)
      p.showOutsideRange = data.showOutsideRange;
    if ("expandAge" in data && data.expandAge !== undefined)
      p.expandAge = data.expandAge;
    if ("expandDistance" in data && data.expandDistance !== undefined)
      p.expandDistance = data.expandDistance;
    if ("expandHeight" in data && data.expandHeight !== undefined)
      p.expandHeight = data.expandHeight;

    // Discovery filter preferences
    if ("prefMinHeight" in data && data.prefMinHeight !== undefined)
      p.prefMinHeight = data.prefMinHeight;
    if ("prefMaxHeight" in data && data.prefMaxHeight !== undefined)
      p.prefMaxHeight = data.prefMaxHeight;
    if ("prefRace" in data && data.prefRace !== undefined) {
      validateArrayLength(data.prefRace, "prefRace");
      p.prefRace = normalizeArray(data.prefRace);
    }
    if ("prefReligion" in data && data.prefReligion !== undefined) {
      validateArrayLength(data.prefReligion, "prefReligion");
      p.prefReligion = normalizeArray(data.prefReligion);
    }
    if ("prefPolitics" in data && data.prefPolitics !== undefined) {
      validateArrayLength(data.prefPolitics, "prefPolitics");
      p.prefPolitics = normalizeArray(data.prefPolitics);
    }
    if ("prefEducation" in data && data.prefEducation !== undefined) {
      validateArrayLength(data.prefEducation, "prefEducation");
      p.prefEducation = normalizeArray(data.prefEducation);
    }
    if ("prefActivityLevel" in data && data.prefActivityLevel !== undefined)
      p.prefActivityLevel = data.prefActivityLevel;
    if ("prefDrinking" in data && data.prefDrinking !== undefined) {
      validateArrayLength(data.prefDrinking, "prefDrinking");
      p.prefDrinking = normalizeArray(data.prefDrinking);
    }
    if ("prefSmoking" in data && data.prefSmoking !== undefined) {
      validateArrayLength(data.prefSmoking, "prefSmoking");
      p.prefSmoking = normalizeArray(data.prefSmoking);
    }
    if ("prefMarijuana" in data && data.prefMarijuana !== undefined) {
      validateArrayLength(data.prefMarijuana, "prefMarijuana");
      p.prefMarijuana = normalizeArray(data.prefMarijuana);
    }

    const saved = await this.profilesRepo.save(p);

    await this.redis.bumpCacheVersion(uid);
    await this.invalidateProfileCache(uid);
    return await this.toResponse(saved, uid);
  }

  //********************************************************************
  //
  // syncSchoolFromVerifiedEmail Method
  //
  // Derives the school name from a verified email and attaches it to the
  // user's profile. Intended to keep school data server-driven.
  //
  // Return Value
  // ------------
  // Promise<string | null>    Derived school name or null if not set
  //
  // Value Parameters
  // ----------------
  // uid     string    Firebase UID
  // email   string    Verified school email
  //
  //*******************************************************************
  async syncSchoolFromVerifiedEmail(
    uid: string,
    email: string,
  ): Promise<string | null> {
    const derivedSchool = this.deriveSchoolFromEmail(email);
    if (!derivedSchool) return null;

    const profile = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });
    if (!profile) return null;

    if (profile.school === derivedSchool) {
      return derivedSchool;
    }

    profile.school = derivedSchool;
    await this.profilesRepo.save(profile);

    await this.redis.bumpCacheVersion(uid);
    await this.invalidateProfileCache(uid);
    return derivedSchool;
  }

  //********************************************************************
  //
  // deleteProfile Method
  //
  // Deletes a user's profile, all associated photos from S3, and the
  // user account. Invalidates Redis queue cache. Soft fails on user
  // deletion errors.
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
  // profile      Profile|null    Profile entity from database
  // deleteTasks  Promise[]       Array of S3 delete promises
  // key          string          Photo key in loop
  //
  //*******************************************************************
  async deleteProfile(uid: string) {
    const profile = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });
    if (!profile) throw new NotFoundException("Profile not found");

    if (profile.photos?.length) {
      const deleteTasks = profile.photos
        .filter((key): key is string => Boolean(key))
        .map((key) => this.s3.deleteObject(key).catch(() => {}));

      await Promise.all(deleteTasks);
    }

    await this.profilesRepo.delete({ userUid: uid });

    await this.redis.bumpCacheVersion(uid);
    await this.invalidateProfileCache(uid);
    await this.usersService.deleteUser(uid).catch(() => {});
  }

  //********************************************************************
  //
  // updatePhotos Method
  //
  // Updates a user's photo array. Throws NotFoundException if profile
  // doesn't exist. Invalidates Redis queue cache.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
  //
  // Value Parameters
  // ----------------
  // uid     string      Firebase UID
  // photos  string[]    Array of photo URLs
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // p      Profile|null    Profile entity from database
  // saved  Profile         Saved profile entity
  //
  //*******************************************************************
  async updatePhotos(uid: string, photos: string[], photoOriginals?: string[]) {
    const p = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });
    if (!p) throw new NotFoundException("Profile not found");

    // Rate limiting: Check daily upload limit
    const today = new Date().toISOString().split("T")[0];
    const uploadKey = `photo_uploads:${uid}:${today}`;

    const todayUploads = await this.redis.safe(
      () => this.redis.client.get(uploadKey),
      { op: "get", key: uploadKey },
    );
    const uploadCount = todayUploads ? parseInt(todayUploads, 10) : 0;
    const MAX_DAILY_UPLOADS = 20;

    if (uploadCount >= MAX_DAILY_UPLOADS) {
      throw new BadRequestException(
        "Daily photo upload limit reached. Please try again tomorrow.",
      );
    }

    // Check rejected photos limit (prevent spam)
    const rejectedKey = `photo_rejected:${uid}:${today}`;

    const todayRejected = await this.redis.safe(
      () => this.redis.client.get(rejectedKey),
      { op: "get", key: rejectedKey },
    );
    const rejectedCount = todayRejected ? parseInt(todayRejected, 10) : 0;
    const MAX_DAILY_REJECTED = 5;

    if (rejectedCount >= MAX_DAILY_REJECTED) {
      throw new BadRequestException(
        "Too many photos were rejected today. Please review our community guidelines and try again tomorrow.",
      );
    }

    const normalizedPhotos = this.normalizePhotoKeyArray(
      normalizeArray<string>(photos),
    );
    const normalizedOriginals = this.normalizePhotoKeyArray(
      normalizeArray<string>(
        photoOriginals && photoOriginals.length > 0 ? photoOriginals : photos,
      ),
    );

    // Ensure alignment
    while (normalizedOriginals.length < normalizedPhotos.length) {
      normalizedOriginals.push(normalizedPhotos[normalizedOriginals.length]);
    }
    if (normalizedOriginals.length > normalizedPhotos.length) {
      normalizedOriginals.length = normalizedPhotos.length;
    }

    // Get existing photos
    const existingPhotos = Array.isArray(p.photos) ? p.photos : [];
    const newPhotos = normalizedPhotos.filter(
      (key) => !existingPhotos.includes(key),
    );

    // Create ProfilePhoto records for new photos
    for (const photoKey of newPhotos) {
      const originalKey =
        normalizedOriginals[normalizedPhotos.indexOf(photoKey)] ?? photoKey;
      const photoRecord = this.photoRepo.create({
        userId: uid,
        url: photoKey,
        derivedKey: photoKey,
        originalKey,
        status: "pending",
      });
      await this.photoRepo.save(photoRecord);

      // Enqueue for moderation
      await this.moderationQueue.enqueuePhoto(photoRecord.id, photoKey);

      // Increment upload counter

      await this.redis.safe(() => this.redis.client.incr(uploadKey), {
        op: "incr",
        key: uploadKey,
      });
      // Set expiration (24 hours)

      await this.redis.safe(() => this.redis.client.expire(uploadKey, 86400), {
        op: "expire",
        key: uploadKey,
      });
    }

    // Normalize to prevent Postgres "malformed array literal" errors
    p.photos = normalizedPhotos;
    p.photoOriginals = normalizedOriginals;
    const saved = await this.profilesRepo.save(p);

    await this.invalidateProfileCache(uid);
    return await this.toResponse(saved, uid);
  }

  //********************************************************************
  //
  // deletePhotoByIndex Method
  //
  // Deletes a photo at a specific index from a user's profile. Deletes
  // the photo from S3 and removes it from the photos array. Throws
  // NotFoundException if profile or photo doesn't exist. Invalidates
  // Redis queue cache.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
  //
  // Value Parameters
  // ----------------
  // uid     string    Firebase UID
  // index   number    Index of photo to delete
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // p      Profile|null    Profile entity from database
  // saved  Profile         Saved profile entity
  //
  //*******************************************************************
  async deletePhotoByIndex(uid: string, index: number) {
    const p = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });
    if (!p) throw new NotFoundException();
    const photos: string[] = Array.isArray(p.photos)
      ? p.photos.filter((k): k is string => typeof k === "string")
      : [];
    if (!photos[index]) throw new NotFoundException();

    await this.s3.deleteObject(photos[index]).catch(() => {});
    const originals: string[] = Array.isArray(p.photoOriginals)
      ? (p.photoOriginals as unknown[]).filter(
          (k): k is string => typeof k === "string",
        )
      : [];
    if (originals[index]) {
      await this.s3.deleteObject(originals[index]).catch(() => {});
      originals.splice(index, 1);
    }
    photos.splice(index, 1);
    p.photos = photos;
    p.photoOriginals = originals;

    const saved = await this.profilesRepo.save(p);

    await this.invalidateProfileCache(uid);
    return await this.toResponse(saved, uid);
  }

  //********************************************************************
  //
  // getPublicProfile Method
  //
  // Retrieves a public profile by Firebase UID. Throws NotFoundException
  // if profile doesn't exist.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Profile response
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
  // p    Profile|null    Profile entity from database
  //
  //*******************************************************************
  async getPublicProfile(uid: string) {
    const cached = await this.getCachedProfileResponse(uid, "public");
    if (cached) return cached;

    const p = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });
    if (!p) throw new NotFoundException();
    const response = await this.toResponse(p, null); // Public view - no viewer UID
    await this.setCachedProfileResponse(uid, "public", response);
    return response;
  }

  //********************************************************************
  //
  // pauseProfile Method
  //
  // Pauses a user's profile (hides it from discovery). Throws
  // NotFoundException if profile doesn't exist. Invalidates Redis
  // queue cache.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
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
  // p      Profile|null    Profile entity from database
  // saved  Profile         Saved profile entity
  //
  //*******************************************************************
  async pauseProfile(
    uid: string,
  ): Promise<ProfileResponse | { success: boolean; paused: boolean }> {
    const p = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });

    // If profile is missing (e.g., freshly deleted or not onboarded), return
    // a soft success so the client UX doesn't error out.
    if (!p) {
      this.logger.warn(`pauseProfile: profile missing for uid=${uid}`);
      return { success: true, paused: true };
    }

    p.paused = true;
    const saved = await this.profilesRepo.save(p);

    await this.invalidateProfileCache(uid);
    return await this.toResponse(saved, uid);
  }

  //********************************************************************
  //
  // unpauseProfile Method
  //
  // Unpauses a user's profile (makes it visible in discovery again).
  // Throws NotFoundException if profile doesn't exist. Invalidates
  // Redis queue cache.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
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
  // p      Profile|null    Profile entity from database
  // saved  Profile         Saved profile entity
  //
  //*******************************************************************
  async unpauseProfile(
    uid: string,
  ): Promise<ProfileResponse | { success: boolean; paused: boolean }> {
    const p = await this.profilesRepo.findOne({
      where: { userUid: uid, deletedAt: IsNull() },
    });

    if (!p) {
      this.logger.warn(`unpauseProfile: profile missing for uid=${uid}`);
      return { success: true, paused: false };
    }

    p.paused = false;
    const saved = await this.profilesRepo.save(p);

    await this.invalidateProfileCache(uid);
    return await this.toResponse(saved, uid);
  }

  //********************************************************************
  //
  // updateLocation Method
  //
  // Updates a user's location coordinates. Delegates to UsersService
  // and invalidates Redis queue cache.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
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
  // None
  //
  //*******************************************************************
  async updateLocation(uid: string, lat: number, lng: number) {
    if (typeof lat !== "number" || isNaN(lat)) {
      throw new BadRequestException("Latitude must be a valid number");
    }
    if (typeof lng !== "number" || isNaN(lng)) {
      throw new BadRequestException("Longitude must be a valid number");
    }
    await this.usersService.updateLocation(uid, lat, lng);
    await this.invalidateProfileCache(uid);
  }

  //********************************************************************
  //
  // parseHeightToInches Method
  //
  // Converts a height string (e.g., "5'6\"") to total inches.
  //
  // Return Value
  // ------------
  // number|null    Total inches or null if parsing fails
  //
  // Value Parameters
  // ----------------
  // heightStr    string    Height string in format "X'Y\""
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // match    RegExpMatchArray|null    Regex match result
  // feet     number                   Feet component
  // inches   number                   Inches component
  //
  //*******************************************************************
  private parseHeightToInches(heightStr: string): number | null {
    const match = heightStr.match(/(\d+)'(\d+)"/);
    if (!match) return null;
    const feet = parseInt(match[1], 10);
    const inches = parseInt(match[2], 10);
    return feet * 12 + inches;
  }

  //********************************************************************
  //
  // getPhotoStatuses Method
  //
  // Returns moderation status for all user's photos.
  //
  // Return Value
  // ------------
  // Promise<ProfilePhoto[]>    Array of photo statuses
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  //*******************************************************************
  async getPhotoStatuses(uid: string): Promise<ProfilePhoto[]> {
    return this.photoRepo.find({
      where: { userId: uid },
      order: { createdAt: "DESC" },
    });
  }
}
