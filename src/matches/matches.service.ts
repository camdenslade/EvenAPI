//********************************************************************
//
// MatchesService Class
//
// Service for managing matches between users. Handles match creation,
// expiration (14 days if no messages), restoration of expired matches,
// and match retrieval with lazy expiration. Updates matches when messages
// are sent to prevent expiration.
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
// EXPIRATION_MS    number                  Match expiration time in milliseconds (14 days)
// matchesRepo      Repository<Match>       TypeORM repository for matches
// threadsRepo      Repository<Thread>      TypeORM repository for threads
// profilesRepo     Repository<Profile>     TypeORM repository for profiles
// users            UsersService            Users service
// profiles         ProfilesService         Profiles service
//
//*******************************************************************

import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In, DataSource, IsNull } from "typeorm";

import { Match } from "../database/entities/match.entity";
import { Thread } from "../database/entities/thread.entity";
import { Profile } from "../database/entities/profile.entity";

import { ProfilesService } from "../profiles/profiles.service";
import { UsersService } from "../users/users.service";
import { BlocksService } from "../blocks/blocks.service";
import { ChatGateway } from "../chat/chat.gateway";

@Injectable()
export class MatchesService {
  private readonly EXPIRATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

  constructor(
    @InjectRepository(Match)
    private readonly matchesRepo: Repository<Match>,

    @InjectRepository(Thread)
    private readonly threadsRepo: Repository<Thread>,

    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,

    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly blocksService: BlocksService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    private readonly dataSource: DataSource,
  ) {}

  //********************************************************************
  //
  // hasExpired Function
  //
  // Checks if a match has expired. Matches with messages never expire.
  // Matches without messages expire after EXPIRATION_MS.
  //
  // Return Value
  // ------------
  // boolean    True if match has expired
  //
  // Value Parameters
  // ----------------
  // match    Match    Match entity to check
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // age    number    Age of match in milliseconds
  //
  //*******************************************************************
  private hasExpired(match: Match): boolean {
    if (match.status === "expired") return true;

    if (match.firstMessageAt) return false;

    const age = Date.now() - new Date(match.createdAt).getTime();
    return age >= this.EXPIRATION_MS;
  }

  //********************************************************************
  //
  // expireIfNeeded Function
  //
  // Expires a match if it has expired. Invalidates Redis queues for
  // both users.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // match    Match    Match entity to check and expire
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
  private async expireIfNeeded(match: Match): Promise<void> {
    if (!this.hasExpired(match)) return;
    if (match.status === "expired") return;

    match.status = "expired";
    await this.matchesRepo.save(match);
  }

  //********************************************************************
  //
  // reviveMatch Method
  //
  // Restores an expired match (mutual-like revival). Sets status to
  // "restored" and updates timestamps. Invalidates Redis queues.
  //
  // Return Value
  // ------------
  // Promise<Match>    Revived match entity
  //
  // Value Parameters
  // ----------------
  // match    Match    Expired match entity to revive
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // now     Date        Current timestamp
  // saved   Match       Saved match entity
  //
  //*******************************************************************
  async reviveMatch(match: Match): Promise<Match> {
    const now = new Date();

    match.status = "restored";
    match.restoredAt = now;
    match.lastActivityAt = now;

    const saved = await this.matchesRepo.save(match);

    // Emit real-time match revival event to both users
    this.emitMatchUpdated(saved, match.userAUid, match.userBUid);

    return saved;
  }

  //********************************************************************
  //
  // createMatch Method
  //
  // Creates a match between two users. Never creates a thread here.
  // Revives existing expired matches. Returns existing active/restored
  // matches. Invalidates Redis queues for both users.
  //
  // Return Value
  // ------------
  // Promise<Match>    Created or existing match entity
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
  // existing    Match|null    Existing match record
  // now         Date          Current timestamp
  // newMatch    Match         Newly created match entity
  // saved       Match         Saved match entity
  //
  //*******************************************************************
  async createMatch(uidA: string, uidB: string): Promise<Match> {
    await this.users.ensureUserExists(uidA, null, null);
    await this.users.ensureUserExists(uidB, null, null);

    // Enforce SafetyExclusion (internal, persistent)
    // SafetyExclusion persists across account deletion by design
    // Excluded users cannot match - enforcement is silent (no error exposed to users)
    const isExcluded = await this.blocksService.isExcluded(uidA, uidB);
    if (isExcluded) {
      // Silently prevent match creation - excluded users cannot interact
      // SafetyExclusion persists across account deletion by design
      // Return existing expired match if it exists to maintain API contract
      // The exclusion prevents actual interaction, but we return something to avoid errors
      const expired = await this.matchesRepo.findOne({
        where: [
          { userAUid: uidA, userBUid: uidB, status: "expired" },
          { userAUid: uidB, userBUid: uidA, status: "expired" },
        ],
      });
      if (expired) return expired;
      // Throw ForbiddenException but with generic message - don't expose exclusion
      throw new ForbiddenException("Cannot create match");
    }

    const existing = await this.matchesRepo.findOne({
      where: [
        { userAUid: uidA, userBUid: uidB },
        { userAUid: uidB, userBUid: uidA },
      ],
    });

    if (
      existing &&
      (existing.status === "active" || existing.status === "restored")
    ) {
      return existing;
    }

    if (existing && existing.status === "expired") {
      return this.reviveMatch(existing);
    }

    // Use transaction to prevent race conditions when two users like simultaneously
    const saved = await this.dataSource.transaction(async (manager) => {
      // Double-check for existing match within transaction
      const existingInTx = await manager.findOne(Match, {
        where: [
          { userAUid: uidA, userBUid: uidB },
          { userAUid: uidB, userBUid: uidA },
        ],
      });

      if (
        existingInTx &&
        (existingInTx.status === "active" || existingInTx.status === "restored")
      ) {
        return existingInTx;
      }

      if (existingInTx && existingInTx.status === "expired") {
        // Revive within transaction
        existingInTx.status = "restored";
        existingInTx.restoredAt = new Date();
        existingInTx.lastActivityAt = new Date();
        return await manager.save(Match, existingInTx);
      }

      const now = new Date();

      const newMatch = manager.create(Match, {
        userAUid: uidA,
        userBUid: uidB,
        createdAt: now,
        lastActivityAt: now,
        firstMessageAt: null,
        restoredAt: null,
        status: "active",
      });

      return await manager.save(Match, newMatch);
    });

    // Emit real-time match creation event to both users
    this.emitMatchCreated(saved, uidA, uidB);

    return saved;
  }

  //********************************************************************
  //
  // updateOnMessage Method
  //
  // Updates a match when a message is sent. Sets firstMessageAt if
  // not already set, updates lastActivityAt, and restores expired
  // matches. Invalidates Redis queues.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // matchId    string    Match ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // match    Match|null    Match entity from database
  // now      Date          Current timestamp
  //
  //*******************************************************************
  async updateOnMessage(matchId: string): Promise<void> {
    const match = await this.matchesRepo.findOne({ where: { id: matchId } });
    if (!match) return;

    const now = new Date();

    if (!match.firstMessageAt) {
      match.firstMessageAt = now;
    }

    match.lastActivityAt = now;

    if (match.status === "expired") {
      match.status = "restored";
      match.restoredAt = now;
    }

    await this.matchesRepo.save(match);
  }

  //********************************************************************
  //
  // getMatches Method
  //
  // Gets all matches for a user (only active and restored). Applies
  // lazy expiration. Returns matches with profile data for the other user.
  //
  // Return Value
  // ------------
  // Promise<Array>    Array of match objects with profile data
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
  // matches      Match[]        All matches for the user
  // m            Match          Match in loop
  // visible      Match[]        Filtered active/restored matches
  // otherUids    string[]       Array of other user UIDs
  // profiles     Profile[]      Profile entities for other users
  // m            Match          Match in map loop
  // otherUid     string         Other user's UID
  //
  //*******************************************************************
  async getMatches(uid: string) {
    const expiryDate = new Date(Date.now() - this.EXPIRATION_MS);

    // Optimized query: filter by status and expiration in SQL
    // For matches screen, we only want unmessaged matches (firstMessageAt IS NULL)
    // that are still within the expiration window
    const matches = await this.matchesRepo
      .createQueryBuilder("match")
      .where("(match.userAUid = :uid OR match.userBUid = :uid)", { uid })
      .andWhere("match.status IN (:...statuses)", {
        statuses: ["active", "restored"],
      })
      .andWhere("match.firstMessageAt IS NULL")
      .andWhere("match.createdAt > :expiryDate", { expiryDate })
      .orderBy("match.lastActivityAt", "DESC")
      .getMany();

    // Batch expire any matches that need expiration (should be rare edge cases)
    const toExpire = matches.filter((m) => this.hasExpired(m));
    if (toExpire.length > 0) {
      await this.matchesRepo.update(
        { id: In(toExpire.map((m) => m.id)) },
        { status: "expired" },
      );
    }

    // Get profiles for other users in a single query
    const otherUids = matches
      .map((m) => (m.userAUid === uid ? m.userBUid : m.userAUid))
      .filter((otherUid, index, self) => self.indexOf(otherUid) === index);

    const profiles =
      otherUids.length > 0
        ? await this.profilesRepo.find({
            where: { userUid: In(otherUids), deletedAt: IsNull() },
          })
        : [];

    const profileMap = new Map(profiles.map((p) => [p.userUid, p]));

    const transformedMatches = await Promise.all(
      matches
        .filter((m) => !this.hasExpired(m))
        .map(async (m) => {
          const otherUid = m.userAUid === uid ? m.userBUid : m.userAUid;
          const profile = profileMap.get(otherUid);

          return {
            matchId: m.id,
            userUid: otherUid,
            profile: profile
              ? await this.profiles.toResponse(profile, uid)
              : null,
            createdAt: m.createdAt,
            status: m.status,
            lastActivityAt: m.lastActivityAt,
          };
        }),
    );

    return transformedMatches;
  }

  //********************************************************************
  //
  // getMatchById Method
  //
  // Gets a match by ID with lazy expiration.
  //
  // Return Value
  // ------------
  // Promise<Match | null>    Match entity or null
  //
  // Value Parameters
  // ----------------
  // id    string    Match ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // match    Match|null    Match entity from database
  //
  //*******************************************************************
  async getMatchById(id: string): Promise<Match | null> {
    const match = await this.matchesRepo.findOne({ where: { id } });
    if (!match) return null;

    await this.expireIfNeeded(match);
    return match;
  }

  //********************************************************************
  //
  // unmatch Method
  //
  // Marks a match as expired (soft unmatch) for either participant.
  //
  //********************************************************************
  async unmatch(uid: string, matchId: string): Promise<void> {
    const match = await this.matchesRepo.findOne({ where: { id: matchId } });
    if (!match) {
      throw new NotFoundException("Match not found");
    }
    if (match.userAUid !== uid && match.userBUid !== uid) {
      throw new ForbiddenException("Cannot unmatch this pair");
    }

    match.status = "expired";
    match.lastActivityAt = new Date();
    await this.matchesRepo.save(match);
  }

  //********************************************************************
  //
  // emitMatchCreated Method
  //
  // Emits WebSocket event to notify both users when a match is created.
  //
  //*******************************************************************
  private emitMatchCreated(match: Match, uidA: string, uidB: string): void {
    try {
      const matchData = {
        matchId: match.id,
        userAUid: match.userAUid,
        userBUid: match.userBUid,
        createdAt: match.createdAt,
        status: match.status,
      };

      // Emit to both users' rooms
      this.chatGateway?.server
        ?.to(`user:${uidA}`)
        .emit("matchCreated", matchData);
      this.chatGateway?.server
        ?.to(`user:${uidB}`)
        .emit("matchCreated", matchData);
    } catch {
      // Silently fail - WebSocket events are best-effort
    }
  }

  //********************************************************************
  //
  // emitMatchUpdated Method
  //
  // Emits WebSocket event to notify both users when a match is updated.
  //
  //*******************************************************************
  private emitMatchUpdated(match: Match, uidA: string, uidB: string): void {
    try {
      const matchData = {
        matchId: match.id,
        userAUid: match.userAUid,
        userBUid: match.userBUid,
        status: match.status,
        lastActivityAt: match.lastActivityAt,
      };

      // Emit to both users' rooms
      this.chatGateway?.server
        ?.to(`user:${uidA}`)
        .emit("matchUpdated", matchData);
      this.chatGateway?.server
        ?.to(`user:${uidB}`)
        .emit("matchUpdated", matchData);
    } catch {
      // Silently fail - WebSocket events are best-effort
    }
  }
}
