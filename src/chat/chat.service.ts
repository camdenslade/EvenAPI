//********************************************************************
//
// ChatService Class
//
// Service for managing chat threads and messages. Handles thread creation,
// message sending, access control, and thread preview generation. Integrates
// with matches to ensure only matched users can communicate. Revives expired
// matches when messages are sent.
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
// threadsRepo    Repository<Thread>      TypeORM repository for threads
// messagesRepo   Repository<Message>     TypeORM repository for messages
// matchesRepo    Repository<Match>       TypeORM repository for matches
// profilesRepo   Repository<Profile>     TypeORM repository for profiles
// users          UsersService            Users service
// matchesService MatchesService          Matches service
//
//*******************************************************************

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In, Not, IsNull } from "typeorm";

import { Thread } from "../database/entities/thread.entity";
import { Message } from "../database/entities/message.entity";
import { Match } from "../database/entities/match.entity";
import { Profile } from "../database/entities/profile.entity";
import { User } from "../database/entities/user.entity";

import { UsersService } from "../users/users.service";
import { MatchesService } from "../matches/matches.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ProfilesService } from "../profiles/profiles.service";
import { BlocksService } from "../blocks/blocks.service";
import { RedisService } from "../redis/redis.service";

import type { MatchThread } from "../types/chat";

type ActiveThreadPreview = Extract<
  MatchThread,
  { status: "active" | "restored" }
>;

type CachedThreadPreview = ActiveThreadPreview & {
  userUid: string;
};

@Injectable()
export class ChatService {
  private readonly threadPreviewTtlSeconds = 120; // short-lived cache for thread previews
  private readonly messagesCacheTtlSeconds = 300; // messages are append-only; safe to cache briefly

  constructor(
    @InjectRepository(Thread)
    private readonly threadsRepo: Repository<Thread>,

    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,

    @InjectRepository(Match)
    private readonly matchesRepo: Repository<Match>,

    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly users: UsersService,
    @Inject(forwardRef(() => MatchesService))
    private readonly matchesService: MatchesService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
    private readonly blocksService: BlocksService,
    private readonly redis: RedisService,
  ) {}

  private threadPreviewCacheKey(uid: string) {
    return `threads:previews:${uid}`;
  }

  private messagesCacheKey(threadId: string, before?: string | null) {
    return before
      ? `msgs:${threadId}:before:${before}`
      : `msgs:${threadId}:all`;
  }

  private async invalidateThreadPreviewCache(uids: string[]) {
    await Promise.all(
      uids.map((uid) =>
        this.redis.safe(
          () => this.redis.delete(this.threadPreviewCacheKey(uid)),
          { op: "delete", key: this.threadPreviewCacheKey(uid) },
        ),
      ),
    );
  }

  private async invalidateMessagesCache(threadId: string) {
    // Delete both full and cursored variants
    await this.redis.safe(() => this.redis.delete(`msgs:${threadId}:all`), {
      op: "delete",
      key: `msgs:${threadId}:all`,
    });
  }

  //********************************************************************
  //
  // findOrCreateThread Method
  //
  // Finds an existing thread for a match or creates a new one. Handles
  // race conditions with unique constraint violations.
  //
  // Return Value
  // ------------
  // Promise<Thread>    Thread entity
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
  // existing    Thread|null    Existing thread or null
  // now         Date           Current timestamp
  // thread      Thread         Newly created thread entity
  // err         Error          Error object
  // e           Object         Error with code property
  // later       Thread|null    Thread found after race condition
  //
  //*******************************************************************
  async findOrCreateThread(matchId: string): Promise<Thread> {
    const existing = await this.threadsRepo.findOne({ where: { matchId } });
    if (existing) return existing;

    const now = new Date();
    const thread = this.threadsRepo.create({
      matchId,
      createdAt: now,
      lastMessageAt: now,
    });

    try {
      return await this.threadsRepo.save(thread);
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "23505") {
        const later = await this.threadsRepo.findOne({ where: { matchId } });
        if (later) return later;
      }
      throw err;
    }
  }

  //********************************************************************
  //
  // validateParticipant Function
  //
  // Validates that a user is a participant in a match. Throws
  // ForbiddenException if not.
  //
  // Return Value
  // ------------
  // void
  //
  // Value Parameters
  // ----------------
  // match    Match    Match entity
  // uid      string   Firebase UID to validate
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
  private validateParticipant(match: Match, uid: string): void {
    if (match.userAUid !== uid && match.userBUid !== uid) {
      throw new ForbiddenException("Not a match participant");
    }
  }

  //********************************************************************
  //
  // reviveIfExpired Function
  //
  // Revives an expired match if needed. Updates match status and
  // timestamps.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // match    Match    Match entity to check and revive
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // revived    Match    Revived match entity
  //
  //*******************************************************************
  private async reviveIfExpired(match: Match): Promise<void> {
    if (match.status !== "expired") return;

    const revived = await this.matchesService.reviveMatch(match);

    match.status = revived.status;
    match.restoredAt = revived.restoredAt;
    match.lastActivityAt = revived.lastActivityAt;

    await this.matchesRepo.save(match);
  }

  //********************************************************************
  //
  // sendMessage Method
  //
  // Sends a message in a match thread. Validates participant access,
  // revives expired matches, creates thread if needed, saves message,
  // and updates match/thread timestamps.
  //
  // Return Value
  // ------------
  // Promise<Message>    Saved message entity
  //
  // Value Parameters
  // ----------------
  // matchId     string    Match ID
  // senderUid   string    Firebase UID of sender
  // content     string    Message text content
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // senderId        string        Sender ID (Firebase UID)
  // match           Match|null    Match entity
  // thread          Thread        Thread entity
  // message         Message       Newly created message entity
  // saved           Message       Saved message entity
  // now             Date          Current timestamp
  //
  //*******************************************************************
  async sendMessage(matchId: string, senderUid: string, content: string) {
    const sender = await this.userRepo.findOne({ where: { uid: senderUid } });
    if (!sender) throw new NotFoundException("User not found");

    const match = await this.matchesRepo.findOne({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");

    this.validateParticipant(match, senderUid);
    await this.reviveIfExpired(match);

    // Enforce SafetyExclusion (internal, persistent)
    // SafetyExclusion persists across account deletion by design
    // Excluded users cannot send messages - enforcement is silent (no error)
    const recipientUid =
      match.userAUid === senderUid ? match.userBUid : match.userAUid;
    const isExcluded = await this.blocksService.isExcluded(
      senderUid,
      recipientUid,
    );
    if (isExcluded) {
      // Silently prevent message - excluded users cannot interact
      throw new ForbiddenException("Cannot send message");
    }

    // Resolve sender's Profile
    const senderProfile = await this.profilesRepo.findOne({
      where: { userUid: senderUid, deletedAt: IsNull() },
    });
    if (!senderProfile) {
      throw new NotFoundException("Sender profile not found");
    }

    const thread = await this.findOrCreateThread(matchId);

    const message = this.messagesRepo.create({
      threadId: thread.id,
      senderProfileId: senderProfile.id,
      text: content,
      imageUrl: null,
    });

    const saved = await this.messagesRepo.save(message);

    const now = new Date();

    if (!match.firstMessageAt) match.firstMessageAt = now;
    match.lastActivityAt = now;
    await this.matchesRepo.save(match);

    thread.lastMessageAt = now;
    await this.threadsRepo.save(thread);
    await this.invalidateMessagesCache(thread.id);
    await this.invalidateThreadPreviewCache([match.userAUid, match.userBUid]);

    // Send notification to recipient (not sender)
    const senderProfileForNotification =
      await this.profiles.getProfile(senderUid);
    const senderFirstName =
      senderProfileForNotification?.name?.split(" ")[0] ?? "Someone";

    await this.notifications.sendNewMessageNotification(
      recipientUid,
      senderFirstName,
      content,
      thread.id,
    );

    // Reload message with senderProfile relation for transformation
    const messageWithProfile = await this.messagesRepo.findOne({
      where: { id: saved.id },
      relations: ["senderProfile"],
    });

    if (!messageWithProfile) {
      throw new Error("Failed to reload message after save");
    }

    return this.transformMessageToResponse(messageWithProfile);
  }

  //********************************************************************
  //
  // getMatchForBroadcast Method
  //
  // Gets match for WebSocket broadcasting. Lightweight method that
  // only fetches user UIDs needed for routing messages.
  //
  //*******************************************************************
  async getMatchForBroadcast(matchId: string): Promise<Match | null> {
    return this.matchesRepo.findOne({
      where: { id: matchId },
      select: ["id", "userAUid", "userBUid"],
    });
  }

  //********************************************************************
  //
  // userCanAccessThread Method
  //
  // Checks if a user can access a thread by verifying they are a
  // participant in the associated match.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if user can access thread
  //
  // Value Parameters
  // ----------------
  // uid       string    Firebase UID
  // threadId  string    Thread ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // thread    Thread|null    Thread entity
  // match     Match|null     Match entity
  //
  //*******************************************************************
  async userCanAccessThread(uid: string, threadId: string): Promise<boolean> {
    const thread = await this.threadsRepo.findOne({ where: { id: threadId } });
    if (!thread) return false;

    const match = await this.matchesRepo.findOne({
      where: { id: thread.matchId },
    });
    if (!match) return false;

    return match.userAUid === uid || match.userBUid === uid;
  }

  //********************************************************************
  //
  // getMatchIdFromThread Method
  //
  // Gets the match ID associated with a thread.
  //
  // Return Value
  // ------------
  // Promise<string | null>    Match ID or null
  //
  // Value Parameters
  // ----------------
  // threadId    string    Thread ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // thread    Thread|null    Thread entity
  //
  //*******************************************************************
  async getMatchIdFromThread(threadId: string): Promise<string | null> {
    const thread = await this.threadsRepo.findOne({ where: { id: threadId } });
    return thread?.matchId ?? null;
  }

  //********************************************************************
  //
  // getUserThreads Method
  //
  // Gets all thread previews for a user. Returns active and restored
  // matches that have sent at least one message. Includes partner
  // profile data and last message information.
  //
  // Return Value
  // ------------
  // Promise<MatchThread[]>    Array of thread preview objects
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
  // matches       Match[]        Matches with messages
  // threads       Thread[]       Thread entities
  // result        MatchThread[]  Result array
  // t             Thread         Thread in loop
  // match         Match|undefined Match entity
  // partnerUid    string         Partner's Firebase UID
  // profile       Profile|null   Partner's profile
  // lastMsg       Message|null   Last message in thread
  // lastMessage   string|null    Last message text
  // lastTimestamp number         Last message timestamp
  //
  //*******************************************************************
  async getUserThreads(uid: string): Promise<MatchThread[]> {
    const cacheKey = this.threadPreviewCacheKey(uid);
    const cachedRaw = await this.redis.safe(
      () => this.redis.getJson<unknown>(cacheKey),
      { op: "getJson", key: cacheKey },
    );
    const cached = Array.isArray(cachedRaw)
      ? (cachedRaw as CachedThreadPreview[])
      : null;
    if (cached) {
      const hydrated = await Promise.all<MatchThread | null>(
        cached.map(async (item) => {
          const profile = await this.profiles.getProfile(item.userUid);
          if (!profile) return null;
          return {
            status: item.status,
            threadId: item.threadId,
            matchId: item.matchId,
            user: {
              uid: item.userUid,
              name: profile.name,
              profileImageUrl: profile.profileImageUrl ?? "",
            },
            lastMessage: item.lastMessage,
            lastTimestamp: item.lastTimestamp,
            lastMessageSenderId: item.lastMessageSenderId,
          };
        }),
      );
      return hydrated
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    }

    const matches = await this.matchesRepo.find({
      where: [
        { userAUid: uid, firstMessageAt: Not(IsNull()) },
        { userBUid: uid, firstMessageAt: Not(IsNull()) },
      ],
    });

    if (matches.length === 0) return [];

    const threads = await this.threadsRepo.find({
      where: { matchId: In(matches.map((m) => m.id)) },
    });

    const result: MatchThread[] = [];

    for (const t of threads) {
      const match = matches.find((m) => m.id === t.matchId);
      if (!match) continue;

      const partnerUid =
        match.userAUid === uid ? match.userBUid : match.userAUid;

      const profile = await this.profilesRepo.findOne({
        where: { userUid: partnerUid, deletedAt: IsNull() },
      });
      if (!profile) continue;

      // Transform profile to get presigned URLs for photos
      const profileResponse = await this.profiles.toResponse(profile, uid);

      const lastMsg = await this.messagesRepo.findOne({
        where: { threadId: t.id },
        order: { createdAt: "DESC" },
        // senderProfile is eager: true, so it should load automatically
      });

      const lastMessage = lastMsg?.text ?? null;
      const lastTimestamp = lastMsg?.createdAt
        ? lastMsg.createdAt.getTime()
        : 0;

      // Get sender UID - try from relation first, fallback to querying profile directly
      let lastMessageSenderId: string | null = null;
      if (lastMsg) {
        if (lastMsg.senderProfile?.userUid) {
          lastMessageSenderId = lastMsg.senderProfile.userUid;
        } else if (lastMsg.senderProfileId) {
          // Fallback: query profile directly if relation didn't load
          const senderProfile = await this.profilesRepo.findOne({
            where: { id: lastMsg.senderProfileId, deletedAt: IsNull() },
          });
          lastMessageSenderId = senderProfile?.userUid ?? null;
          if (!lastMessageSenderId) {
            lastMessageSenderId = null;
          }
        }
      }

      result.push({
        status: match.status === "restored" ? "restored" : "active",
        threadId: t.id,
        matchId: match.id,
        user: {
          uid: partnerUid,
          name: profileResponse.name,
          profileImageUrl: profileResponse.profileImageUrl ?? "",
        },
        lastMessage,
        lastTimestamp,
        lastMessageSenderId,
      });
    }

    const sorted = result.sort((a, b) => b.lastTimestamp - a.lastTimestamp);

    const activeThreads = sorted.filter(
      (item): item is ActiveThreadPreview =>
        item.status === "active" || item.status === "restored",
    );

    const summaries = activeThreads.map((item) => ({
      status: item.status,
      threadId: item.threadId,
      matchId: item.matchId,
      userUid: item.user.uid,
      lastMessage: item.lastMessage,
      lastTimestamp: item.lastTimestamp,
      lastMessageSenderId: item.lastMessageSenderId,
    }));

    await this.redis.safe(
      () =>
        this.redis.setJson(cacheKey, summaries, this.threadPreviewTtlSeconds),
      {
        op: "setJson",
        key: cacheKey,
        ttlSeconds: this.threadPreviewTtlSeconds,
      },
    );

    return sorted;
  }

  //********************************************************************
  //
  // transformMessageToResponse Method
  //
  // Transforms a Message entity to the frontend format with senderId
  // (Firebase UID) instead of senderProfileId.
  //
  // Return Value
  // ------------
  // Object    Message in frontend format
  //
  // Value Parameters
  // ----------------
  // message    Message    Message entity with senderProfile relation
  //
  //*******************************************************************
  private transformMessageToResponse(message: Message): {
    id: string;
    threadId: string;
    senderId: string;
    text: string;
    imageUrl: string | null;
    createdAt: string;
  } {
    return {
      id: message.id,
      threadId: message.threadId,
      senderId: message.senderProfile?.userUid ?? "",
      text: message.text,
      imageUrl: message.imageUrl,
      createdAt: message.createdAt.toISOString(),
    };
  }

  //********************************************************************
  //
  // getMessagesForThread Method
  //
  // Gets all messages for a thread, ordered by creation time ascending.
  // Returns messages in frontend format with senderId.
  //
  // Return Value
  // ------------
  // Promise<Array>    Array of messages in frontend format
  //
  // Value Parameters
  // ----------------
  // threadId    string    Thread ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // messages    Message[]    Raw message entities
  //
  //*******************************************************************
  async getMessagesForThread(threadId: string) {
    const cacheKey = this.messagesCacheKey(threadId, null);
    const cached = await this.redis.safe(
      () =>
        this.redis.getJson<
          Array<{
            id: string;
            threadId: string;
            senderId: string;
            text: string;
            imageUrl: string | null;
            createdAt: string;
          }>
        >(cacheKey),
      { op: "getJson", key: cacheKey },
    );
    if (cached) {
      return cached;
    }

    const messages = await this.messagesRepo.find({
      where: { threadId },
      order: { createdAt: "ASC" },
      relations: ["senderProfile"],
    });
    const transformed = messages.map((msg) =>
      this.transformMessageToResponse(msg),
    );

    await this.redis.safe(
      () =>
        this.redis.setJson(cacheKey, transformed, this.messagesCacheTtlSeconds),
      {
        op: "setJson",
        key: cacheKey,
        ttlSeconds: this.messagesCacheTtlSeconds,
      },
    );

    return transformed;
  }

  //********************************************************************
  //
  // getMessagesBetweenUsers Method
  //
  // Gets all messages between two users. Used by reviews service to
  // check message exchange thresholds.
  //
  // Return Value
  // ------------
  // Promise<Message[]>    Array of message entities
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
  // match     Match|null    Match between the two users
  // thread    Thread|null   Thread for the match
  //
  //*******************************************************************
  async getMessagesBetweenUsers(
    uidA: string,
    uidB: string,
  ): Promise<Message[]> {
    const match = await this.matchesRepo.findOne({
      where: [
        { userAUid: uidA, userBUid: uidB },
        { userAUid: uidB, userBUid: uidA },
      ],
    });

    if (!match) return [];

    const thread = await this.threadsRepo.findOne({
      where: { matchId: match.id },
    });

    if (!thread) return [];

    return this.messagesRepo.find({
      where: { threadId: thread.id },
      order: { createdAt: "ASC" },
    });
  }
}
