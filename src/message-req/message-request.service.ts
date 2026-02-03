//********************************************************************
//
// MessageRequestService Class
//
// Service for managing message requests between unmatched users.
// Handles creating pending message requests, accepting/rejecting
// requests, auto-accepting via mutual likes, and creating matches
// and threads. Implements 30-day hide windows on rejection.
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
// HIDE_MS       number                    Hide window duration in milliseconds (30 days)
// reqRepo       Repository<MessageRequest> TypeORM repository for message requests
// threadRepo    Repository<Thread>        TypeORM repository for threads
// msgRepo       Repository<Message>       TypeORM repository for messages
// likeRepo      Repository<Like>          TypeORM repository for likes
// matchRepo     Repository<Match>         TypeORM repository for matches
// profilesRepo  Repository<Profile>       TypeORM repository for profiles
// users         UsersService              Users service
// profiles      ProfilesService           Profiles service
// likeService   LikeService               Like service
// matchesService MatchesService           Matches service
// redis         RedisService              Redis service for cache invalidation
//
//*******************************************************************

import { Injectable, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In, IsNull } from "typeorm";

import { MessageRequest } from "../database/entities/message-request.entity";
import { Thread } from "../database/entities/thread.entity";
import { Message } from "../database/entities/message.entity";
import { Like } from "../database/entities/like.entity";
import { Match } from "../database/entities/match.entity";
import { Profile } from "../database/entities/profile.entity";
import { User } from "../database/entities/user.entity";

import { UsersService } from "../users/users.service";
import { ProfilesService } from "../profiles/profiles.service";
import { LikeService } from "../like/like.service";
import { MatchesService } from "../matches/matches.service";
import { RedisService } from "../redis/redis.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TokensService } from "../tokens/tokens.service";
import { BlocksService } from "../blocks/blocks.service";
import { isDemoUidStatic } from "../constants/review-config";

import { CreateMessageRequestDto } from "./dto/message-request.dto";

@Injectable()
export class MessageRequestService {
  private readonly HIDE_MS = 30 * 24 * 60 * 60 * 1000;
  private readonly pendingListTtlSeconds = 120;
  private readonly pendingCountTtlSeconds = 60;

  private pendingListCacheKey(uid: string) {
    return `msgreq:pending:list:${uid}`;
  }

  private pendingCountCacheKey(uid: string) {
    return `msgreq:pending:count:${uid}`;
  }

  //********************************************************************
  //
  // calculateAge Function
  //
  // Calculates age from a birthday value.
  //
  // Return Value
  // ------------
  // number    Calculated age or 0 if invalid
  //
  // Value Parameters
  // ----------------
  // birthday    Date|string    Birthday value
  //
  //********************************************************************
  private calculateAge(birthday: Date | string): number {
    const dt = new Date(birthday);
    if (Number.isNaN(dt.getTime())) return 0;
    const diff = Date.now() - dt.getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  }

  private async invalidatePendingCaches(uids: string[]) {
    await Promise.all(
      uids.map(async (uid) => {
        await this.redis.safe(
          () => this.redis.delete(this.pendingListCacheKey(uid)),
          { op: "delete", key: this.pendingListCacheKey(uid) },
        );
        await this.redis.safe(
          () => this.redis.delete(this.pendingCountCacheKey(uid)),
          { op: "delete", key: this.pendingCountCacheKey(uid) },
        );
      }),
    );
  }

  constructor(
    @InjectRepository(MessageRequest)
    private readonly reqRepo: Repository<MessageRequest>,

    @InjectRepository(Thread)
    private readonly threadRepo: Repository<Thread>,

    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,

    @InjectRepository(Like)
    private readonly likeRepo: Repository<Like>,

    @InjectRepository(Match)
    private readonly matchRepo: Repository<Match>,

    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly likeService: LikeService,
    private readonly matchesService: MatchesService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokensService,
    private readonly blocksService: BlocksService,
  ) {}

  //********************************************************************
  //
  // createRequest Method
  //
  // Creates a message request from sender to recipient. Handles
  // auto-acceptance if mutual like exists, auto-acceptance if opposite
  // pending request exists, or creates a new pending request. Invalidates
  // Redis queues for both users.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with request status and IDs
  //
  // Value Parameters
  // ----------------
  // senderUid    string                  Firebase UID of sender
  // dto          CreateMessageRequestDto Message request data
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // recipientUid     string                  Recipient's Firebase UID
  // content          string                  Message content
  // imageUrl         string|null|undefined   Optional image URL
  // profile          ProfileResponse|null    Recipient's profile
  // existingPending  MessageRequest|null     Existing pending request
  // likeResult       Object                  Result from like service
  // req              MessageRequest          Created request entity
  // saved            MessageRequest          Saved request entity
  // senderProfile    Profile|null            Sender's profile entity
  //
  //*******************************************************************
  async createRequest(senderUid: string, dto: CreateMessageRequestDto) {
    const { recipientUid, content, imageUrl } = dto;

    if (senderUid === recipientUid) {
      return { error: "cannot message yourself" };
    }

    const senderIsDemo = isDemoUidStatic(senderUid);
    const recipientIsDemo = isDemoUidStatic(recipientUid);
    if (senderIsDemo !== recipientIsDemo) {
      return { error: "user not available" };
    }

    // Simple per-day sender rate limit to reduce spam
    const reqCountKey = `msgreq:count:${senderUid}:${new Date()
      .toISOString()
      .slice(0, 10)}`;
    const incremented = await this.redis.safe(
      () => this.redis.increment(reqCountKey),
      { op: "incr", key: reqCountKey },
    );
    if (incremented !== null && incremented === 1) {
      await this.redis.safe(
        () => this.redis.set(reqCountKey, String(incremented), 24 * 60 * 60),
        { op: "expire", key: reqCountKey },
      );
    }
    if (incremented !== null && incremented > 25) {
      throw new BadRequestException("Message request rate limit exceeded");
    }

    await this.users.ensureUserExists(senderUid, null, null);
    await this.users.ensureUserExists(recipientUid, null, null);

    const profile = await this.profiles.getProfile(recipientUid);
    if (!profile) return { error: "recipient has no profile" };
    if (profile.paused) return { error: "recipient is paused" };

    // Blocked/excluded users cannot be messaged
    const blocked = await this.blocksService.isExcluded(
      senderUid,
      recipientUid,
    );
    if (blocked) {
      return { error: "user not available" };
    }

    // If already matched, do not allow a message request
    const existingMatch = await this.matchRepo.findOne({
      where: [
        {
          userAUid: senderUid,
          userBUid: recipientUid,
          status: In(["active", "restored"]),
        },
        {
          userAUid: recipientUid,
          userBUid: senderUid,
          status: In(["active", "restored"]),
        },
      ],
    });
    if (existingMatch) {
      return { error: "already matched" };
    }

    const existingPending = await this.reqRepo.findOne({
      where: [
        { senderUid, recipientUid, status: "pending" },
        { senderUid: recipientUid, recipientUid: senderUid, status: "pending" },
      ],
    });

    if (existingPending) {
      if (existingPending.senderUid === recipientUid) {
        return this.acceptExistingPending(existingPending);
      }
      return { error: "a pending request already exists" };
    }

    // Check and consume message_request token
    const sender = await this.userRepo.findOne({ where: { uid: senderUid } });
    if (!sender) {
      return { error: "user not found" };
    }

    const consumed = await this.tokens.consumeToken(
      sender.id,
      "message_request",
    );
    if (!consumed) {
      return { error: "insufficient message request tokens" };
    }

    const likeResult = await this.likeService.likeUser(senderUid, recipientUid);

    if (likeResult.match === true) {
      return this.autoAcceptViaMutualLike(
        senderUid,
        recipientUid,
        content,
        imageUrl ?? null,
      );
    }

    const req = this.reqRepo.create({
      senderUid,
      recipientUid,
      content,
      imageUrl: imageUrl ?? null,
      status: "pending",
      acceptedAt: null,
      rejectedAt: null,
    });

    const saved = await this.reqRepo.save(req);

    await this.invalidatePendingCaches([senderUid, recipientUid]);
    await this.redis.safe(() => this.redis.delete(`queue:${senderUid}`), {
      op: "delete",
      key: `queue:${senderUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${recipientUid}`), {
      op: "delete",
      key: `queue:${recipientUid}`,
    });

    // Send notification to recipient (not sender)
    await this.notifications.sendMessageRequestNotification(recipientUid);

    return {
      requestId: saved.id,
      pending: true,
      status: "pending",
    };
  }

  //********************************************************************
  //
  // acceptRequest Method
  //
  // Accepts a pending message request. Creates or revives match, creates
  // thread, inserts first message, clears hide windows, and invalidates
  // Redis queues.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with accepted status and IDs
  //
  // Value Parameters
  // ----------------
  // recipientUid    string    Firebase UID of recipient (accepter)
  // requestId       string    Message request ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // req            MessageRequest|null    Request entity
  // senderUid      string                 Sender's Firebase UID
  // senderProfile  Profile|null           Sender's profile entity
  // match          Match                  Created or revived match entity
  // thread         Thread                 Created thread entity
  //
  //*******************************************************************
  async acceptRequest(recipientUid: string, requestId: string) {
    const req = await this.reqRepo.findOne({ where: { id: requestId } });
    if (!req) return { error: "not found" };
    if (req.recipientUid !== recipientUid) return { error: "not authorized" };

    const senderUid = req.senderUid;

    req.status = "accepted";
    req.acceptedAt = new Date();
    await this.reqRepo.save(req);

    await this.likeService.likeUser(recipientUid, senderUid);

    const match = await this.matchesService.createMatch(
      senderUid,
      recipientUid,
    );

    await this.likeRepo.update(
      { swiperUid: senderUid, targetUid: recipientUid },
      { hiddenUntil: null, isHidden: false },
    );

    await this.likeRepo.update(
      { swiperUid: recipientUid, targetUid: senderUid },
      { hiddenUntil: null, isHidden: false },
    );

    await this.redis.safe(() => this.redis.delete(`queue:${senderUid}`), {
      op: "delete",
      key: `queue:${senderUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${recipientUid}`), {
      op: "delete",
      key: `queue:${recipientUid}`,
    });

    // Resolve sender's Profile
    const senderProfile = await this.profilesRepo.findOne({
      where: { userUid: senderUid, deletedAt: IsNull() },
    });
    if (!senderProfile) {
      return { error: "sender profile not found" };
    }

    const thread = await this.threadRepo.save(
      this.threadRepo.create({
        matchId: match.id,
        lastMessageAt: new Date(),
      }),
    );

    await this.msgRepo.save(
      this.msgRepo.create({
        threadId: thread.id,
        senderProfileId: senderProfile.id,
        text: req.content,
        imageUrl: req.imageUrl,
      }),
    );

    match.status = "active";
    match.lastActivityAt = new Date();
    match.firstMessageAt = match.firstMessageAt ?? new Date();
    await this.matchRepo.save(match);

    await this.invalidatePendingCaches([senderUid, recipientUid]);
    await this.redis.safe(() => this.redis.delete(`queue:${senderUid}`), {
      op: "delete",
      key: `queue:${senderUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${recipientUid}`), {
      op: "delete",
      key: `queue:${recipientUid}`,
    });

    // Send notification to sender (not recipient who accepted)
    await this.notifications.sendRequestAcceptedNotification(
      senderUid,
      thread.id,
    );

    return {
      accepted: true,
      matchId: match.id,
      threadId: thread.id,
    };
  }

  //********************************************************************
  //
  // rejectRequest Method
  //
  // Rejects a pending message request. Sets 30-day hide windows for
  // both users and invalidates Redis queues.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with rejected status
  //
  // Value Parameters
  // ----------------
  // recipientUid    string    Firebase UID of recipient (rejecter)
  // requestId       string    Message request ID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // req       MessageRequest|null    Request entity
  // senderUid string                 Sender's Firebase UID
  // hideUntil Date                   Hide window expiration date
  //
  //*******************************************************************
  async rejectRequest(recipientUid: string, requestId: string) {
    const req = await this.reqRepo.findOne({ where: { id: requestId } });
    if (!req) return { error: "not found" };
    if (req.recipientUid !== recipientUid) return { error: "not authorized" };

    const senderUid = req.senderUid;

    req.status = "rejected";
    req.rejectedAt = new Date();
    await this.reqRepo.save(req);

    const hideUntil = new Date(Date.now() + this.HIDE_MS);

    await this.likeRepo.update(
      { swiperUid: senderUid, targetUid: recipientUid },
      { hiddenUntil: hideUntil },
    );
    await this.likeRepo.update(
      { swiperUid: recipientUid, targetUid: senderUid },
      { hiddenUntil: hideUntil },
    );

    await this.invalidatePendingCaches([senderUid, recipientUid]);
    await this.redis.safe(() => this.redis.delete(`queue:${senderUid}`), {
      op: "delete",
      key: `queue:${senderUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${recipientUid}`), {
      op: "delete",
      key: `queue:${recipientUid}`,
    });

    return { rejected: true };
  }

  //********************************************************************
  //
  // autoAcceptViaMutualLike Function
  //
  // Auto-accepts a message request when mutual like exists. Creates
  // match, thread, and first message. Invalidates Redis queues.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with auto-accepted status and IDs
  //
  // Value Parameters
  // ----------------
  // senderUid    string    Firebase UID of sender
  // recipientUid string    Firebase UID of recipient
  // content      string    Message content
  // imageUrl     string|null Optional image URL
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // senderProfile Profile|null Sender's profile entity
  // match         Match        Created or revived match entity
  // thread        Thread       Created thread entity
  //
  //*******************************************************************
  private async autoAcceptViaMutualLike(
    senderUid: string,
    recipientUid: string,
    content: string,
    imageUrl: string | null,
  ) {
    // Resolve sender's Profile
    const senderProfile = await this.profilesRepo.findOne({
      where: { userUid: senderUid, deletedAt: IsNull() },
    });
    if (!senderProfile) {
      throw new Error("Sender profile not found");
    }

    const match = await this.matchesService.createMatch(
      senderUid,
      recipientUid,
    );

    const thread = await this.threadRepo.save(
      this.threadRepo.create({
        matchId: match.id,
        lastMessageAt: new Date(),
      }),
    );

    await this.msgRepo.save(
      this.msgRepo.create({
        threadId: thread.id,
        senderProfileId: senderProfile.id,
        text: content,
        imageUrl,
      }),
    );

    match.status = "active";
    match.lastActivityAt = new Date();
    match.firstMessageAt = match.firstMessageAt ?? new Date();
    await this.matchRepo.save(match);

    await this.invalidatePendingCaches([senderUid, recipientUid]);
    await this.redis.safe(() => this.redis.delete(`queue:${senderUid}`), {
      op: "delete",
      key: `queue:${senderUid}`,
    });
    await this.redis.safe(() => this.redis.delete(`queue:${recipientUid}`), {
      op: "delete",
      key: `queue:${recipientUid}`,
    });

    // Send notification to recipient about new message (not sender)
    const senderFirstName = senderProfile.name?.split(" ")[0] ?? "Someone";
    await this.notifications.sendNewMessageNotification(
      recipientUid,
      senderFirstName,
      content,
      thread.id,
    );

    return {
      autoAccepted: true,
      matchId: match.id,
      threadId: thread.id,
    };
  }

  //********************************************************************
  //
  // acceptExistingPending Function
  //
  // Accepts an existing opposite-direction pending request. Delegates
  // to acceptRequest method.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object from acceptRequest
  //
  // Value Parameters
  // ----------------
  // existing    MessageRequest    Existing pending request to accept
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
  private async acceptExistingPending(existing: MessageRequest) {
    return this.acceptRequest(existing.recipientUid, existing.id);
  }

  //********************************************************************
  //
  // getPendingForUser Method
  //
  // Gets all pending message requests received by a user.
  //
  // Return Value
  // ------------
  // Promise<MessageRequest[]>    Array of pending request entities
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
  async getPendingForUser(uid: string) {
    const listKey = this.pendingListCacheKey(uid);
    const cached = await this.redis.safe(
      () => this.redis.getJson<MessageRequest[]>(listKey),
      { op: "getJson", key: listKey },
    );
    if (cached) return cached;

    const pending = await this.reqRepo.find({
      where: [{ recipientUid: uid, status: "pending" }],
    });
    await this.redis.safe(
      () => this.redis.setJson(listKey, pending, this.pendingListTtlSeconds),
      {
        op: "setJson",
        key: listKey,
        ttlSeconds: this.pendingListTtlSeconds,
      },
    );
    return pending;
  }

  //********************************************************************
  //
  // getPendingRequests Method
  //
  // Gets all pending message requests received by a user with sender
  // profile data. Returns requests ordered by creation time (oldest first).
  //
  // Return Value
  // ------------
  // Promise<Array<Object>>    Array of pending request objects, each containing:
  //                           id (string), content (string), createdAt (string ISO),
  //                           and sender (object with uid, firstName, photos) or null
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
  // requests    MessageRequest[]    Pending message requests
  // senderUids string[]             Array of sender Firebase UIDs
  // profiles    Profile[]            Profile entities for senders
  // req         MessageRequest       Request in map loop
  // profile     Profile|undefined    Sender's profile
  // firstName   string               First name extracted from profile name
  //
  //*******************************************************************
  async getPendingRequests(recipientUid: string): Promise<
    Array<{
      id: string;
      content: string;
      createdAt: string;
      sender: {
        uid: string;
        firstName: string;
        age: number | null;
        photos: string[];
      } | null;
    }>
  > {
    const requests = await this.reqRepo.find({
      where: { recipientUid, status: "pending" },
      order: { createdAt: "ASC" },
    });

    if (requests.length === 0) return [];

    const senderUids = requests.map((req) => req.senderUid);
    const profiles = await this.profilesRepo.find({
      where: { userUid: In(senderUids), deletedAt: IsNull() },
    });

    return requests.map((req) => {
      const profile = profiles.find((p) => p.userUid === req.senderUid);
      const firstName = profile?.name?.split(" ")[0] ?? "Unknown";

      return {
        id: req.id,
        content: req.content,
        createdAt: req.createdAt.toISOString(),
        sender: profile
          ? {
              uid: profile.userUid,
              firstName,
              age: profile.birthday
                ? this.calculateAge(profile.birthday)
                : null,
              photos: profile.photos ?? [],
            }
          : null,
      };
    });
  }
}
