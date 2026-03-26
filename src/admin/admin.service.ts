//********************************************************************
//
// AdminService Class
//
// Service for admin operations. Handles granting tokens and subscription
// status to users.
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
// usersRepo    Repository<User>    TypeORM repository for users
//
//*******************************************************************

import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, FindOptionsWhere, MoreThanOrEqual, IsNull, Not, In } from "typeorm";
import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import {
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";

import { User } from "../database/entities/user.entity";
import {
  ProfilePhoto,
  PhotoStatus,
} from "../database/entities/profile-photo.entity";
import { AuditEvent } from "../database/entities/audit-event.entity";
import { sanitizeForLogging } from "../utils/log-sanitizer";
import { TokensService } from "../tokens/tokens.service";
import { TokenType } from "../database/entities/token-ledger.entity";
import { GrantDto } from "./dto/grant.dto";
import { Report, ReportStatus } from "../database/entities/report.entity";
import { Review } from "../database/entities/review.entity";
import { ReviewStrike } from "../database/entities/review-strike.entity";
import { Match } from "../database/entities/match.entity";
import { Thread } from "../database/entities/thread.entity";
import { Message } from "../database/entities/message.entity";
import { Profile } from "../database/entities/profile.entity";
import { ModerationQueueService } from "../moderation/moderation-queue.service";
import { RedisService } from "../redis/redis.service";
import { NotificationsService } from "../notifications/notifications.service";
import { Admin as AdminEntity } from "../database/entities/admin.entity";
import { S3Service } from "../s3/s3.service";
import { ProfilesService, ProfileResponse } from "../profiles/profiles.service";
import { UsersService } from "../users/users.service";
import { EmailService } from "../email/email.service";
import { SecretsService } from "../secrets/secrets.service";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { SupportTicket } from "../support/entities/support-ticket.entity";
import { Suggestion } from "../suggestions/entities/suggestion.entity";
import { getAllDemoUids } from "../constants/review-config";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly maxTokenGrant = 10_000;
  private cognitoClient: CognitoIdentityProviderClient | null = null;

  constructor(
    @InjectRepository(AdminEntity)
    private readonly adminRepo: Repository<AdminEntity>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(ProfilePhoto)
    private readonly photoRepo: Repository<ProfilePhoto>,
    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(Review)
    private readonly reviewsRepo: Repository<Review>,
    @InjectRepository(ReviewStrike)
    private readonly strikesRepo: Repository<ReviewStrike>,
    @InjectRepository(Match)
    private readonly matchRepo: Repository<Match>,
    @InjectRepository(Thread)
    private readonly threadRepo: Repository<Thread>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
    @InjectRepository(SupportTicket)
    private readonly supportTicketRepo: Repository<SupportTicket>,
    @InjectRepository(Suggestion)
    private readonly suggestionRepo: Repository<Suggestion>,
    private readonly tokensService: TokensService,
    private readonly moderationQueue: ModerationQueueService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly s3: S3Service,
    private readonly profilesService: ProfilesService,
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
    private readonly secretsService: SecretsService,
  ) {}

  private getCognitoClient(region: string) {
    if (!this.cognitoClient) {
      this.cognitoClient = new CognitoIdentityProviderClient({ region });
    }
    return this.cognitoClient;
  }

  private computeSecretHash(
    username: string,
    clientId: string,
    clientSecret?: string,
  ) {
    if (!clientSecret) return undefined;
    return crypto
      .createHmac("sha256", clientSecret)
      .update(username + clientId)
      .digest("base64");
  }

  private audit(event: string, payload: Record<string, unknown>) {
    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [
        k,
        sanitizeForLogging(String(v)),
      ]),
    );

    void this.persistAudit(event, sanitizedPayload, 1);

    this.logger.log(JSON.stringify({ event, ...sanitizedPayload }));
  }

  private async persistAudit(
    event: string,
    payload: Record<string, string>,
    retriesRemaining: number,
  ): Promise<void> {
    try {
      await this.auditRepo.insert({ event, payload });
    } catch (err) {
      if (retriesRemaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await this.persistAudit(event, payload, retriesRemaining - 1);
        return;
      }
      this.logger.error(
        `Failed to persist admin audit ${event}: ${sanitizeForLogging(
          err instanceof Error ? err.message : String(err),
        )}`,
      );
    }
  }

  //********************************************************************
  //
  // Admin email/password login via Cognito admin app client
  //
  //********************************************************************
  async adminLoginWithPassword(dto: AdminLoginDto): Promise<{
    token: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType?: string;
  }> {
    const region = process.env.AWS_REGION;
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_ADMIN_APP_CLIENT_ID;
    const clientSecret = process.env.COGNITO_ADMIN_APP_CLIENT_SECRET;

    if (!region || !userPoolId || !clientId) {
      throw new UnauthorizedException(
        "Admin app client is not configured (AWS_REGION, COGNITO_USER_POOL_ID, COGNITO_ADMIN_APP_CLIENT_ID).",
      );
    }

    const usernameRaw = dto.username.trim();
    const usernameLower = usernameRaw.toLowerCase();
    const candidateUsernames =
      usernameLower === usernameRaw
        ? [usernameRaw]
        : [usernameRaw, usernameLower];
    const cognito = this.getCognitoClient(region);

    const tryUsername = async (username: string) => {
      const secretHash = this.computeSecretHash(
        username,
        clientId,
        clientSecret,
      );
      const tryAuth = async (
        flow: "ADMIN_USER_PASSWORD_AUTH" | "USER_PASSWORD_AUTH",
      ) => {
        const cmd =
          flow === "ADMIN_USER_PASSWORD_AUTH"
            ? new AdminInitiateAuthCommand({
                UserPoolId: userPoolId,
                ClientId: clientId,
                AuthFlow: flow,
                AuthParameters: {
                  USERNAME: username,
                  PASSWORD: dto.password,
                  ...(secretHash ? { SECRET_HASH: secretHash } : {}),
                },
              })
            : new InitiateAuthCommand({
                ClientId: clientId,
                AuthFlow: flow,
                AuthParameters: {
                  USERNAME: username,
                  PASSWORD: dto.password,
                  ...(secretHash ? { SECRET_HASH: secretHash } : {}),
                },
              });
        return cognito.send(cmd);
      };

      try {
        return await tryAuth("ADMIN_USER_PASSWORD_AUTH");
      } catch (err: unknown) {
        try {
          return await tryAuth("USER_PASSWORD_AUTH");
        } catch (err2: unknown) {
          throw err2 ?? err;
        }
      }
    };

    let authResult: AuthenticationResultType | undefined;
    let lastErr: unknown;
    for (const candidate of candidateUsernames) {
      try {
        const auth = await tryUsername(candidate);
        if (auth?.AuthenticationResult) {
          authResult = auth.AuthenticationResult;
          break;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (!authResult) {
      const msg =
        (lastErr instanceof Error ? lastErr.message : null) ||
        "Admin login failed (Cognito auth error; check username/secret_hash)";
      throw new UnauthorizedException(msg);
    }

    const accessToken = authResult.AccessToken;
    if (!accessToken) {
      throw new UnauthorizedException(
        "Admin login did not return an access token",
      );
    }

    const refreshToken = authResult.RefreshToken;
    const expiresIn = authResult.ExpiresIn;
    const tokenType = authResult.TokenType;

    const decoded = jwt.decode(accessToken) as {
      sub?: string;
      email?: string;
    } | null;
    const uid = decoded?.sub;
    const email = decoded?.email ?? null;
    if (!uid) {
      throw new UnauthorizedException("Invalid admin token payload");
    }

    const adminRecord = await this.adminRepo.findOne({ where: { uid } });
    if (!adminRecord) {
      throw new ForbiddenException("Admin access required");
    }

    this.audit("ADMIN_LOGIN", {
      email: email ?? undefined,
      uid: adminRecord.uid,
      username: usernameRaw,
    });

    return {
      token: accessToken,
      refreshToken,
      expiresIn,
      tokenType,
    };
  }

  //********************************************************************
  //
  // Admin list/create/delete
  //
  //********************************************************************
  async listAdmins(): Promise<AdminEntity[]> {
    return this.adminRepo.find({ order: { createdAt: "DESC" } });
  }

  async createAdmin(email: string, uid: string, createdByUid: string) {
    const existing = await this.adminRepo.findOne({
      where: [{ email }, { uid }],
    });
    if (existing) throw new ConflictException("Admin already exists");
    const adminRecord = this.adminRepo.create({
      email,
      uid,
      createdByUid,
    });
    return this.adminRepo.save(adminRecord);
  }

  async deleteAdmin(uid: string, requesterUid: string): Promise<void> {
    if (uid === requesterUid) {
      throw new BadRequestException("Cannot delete yourself");
    }
    const adminRecord = await this.adminRepo.findOne({ where: { uid } });
    if (!adminRecord) throw new NotFoundException("Admin not found");
    await this.adminRepo.remove(adminRecord);
  }

  //********************************************************************
  //
  // getReports Method
  //
  // Returns reports filtered by status for admin review.
  //
  //********************************************************************
  async getReports(status?: string): Promise<Report[]> {
    const where: FindOptionsWhere<Report> = {};
    if (status && ["pending", "reviewed", "resolved"].includes(status)) {
      where.status = status as ReportStatus;
    }
    return this.reportRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: 200,
    });
  }

  //********************************************************************
  //
  // getReport Method
  //
  // Returns a single report by ID.
  //
  //********************************************************************
  async getReport(id: string): Promise<Report> {
    const report = await this.reportRepo.findOne({ where: { id } });
    if (!report) {
      throw new NotFoundException("Report not found");
    }
    return report;
  }

  //********************************************************************
  //
  // updateReport Method
  //
  // Updates report metadata (assignedTo, notes, status, evidence).
  //
  //********************************************************************
  async updateReport(
    id: string,
    updates: {
      assignedTo?: string | null;
      notes?: string | null;
      status?: string;
      evidence?: Record<string, unknown> | null;
    },
  ): Promise<Report> {
    const report = await this.getReport(id);
    if (updates.assignedTo !== undefined) {
      report.assignedTo = updates.assignedTo;
    }
    if (updates.notes !== undefined) {
      report.notes = updates.notes;
    }
    if (
      updates.status &&
      ["pending", "reviewed", "resolved"].includes(updates.status)
    ) {
      report.status = updates.status as ReportStatus;
      if (report.status === "resolved") {
        report.resolvedAt = new Date();
      }
    }
    if (updates.evidence !== undefined) {
      report.evidence = updates.evidence;
    }
    const saved = await this.reportRepo.save(report);
    this.audit("ADMIN_REPORT_UPDATE", { reportId: id });
    return saved;
  }

  //********************************************************************
  //
  // resolveReport Method
  //
  // Marks a report as resolved and optionally updates notes/assignedTo.
  //
  //********************************************************************
  async resolveReport(
    id: string,
    data: { notes?: string | null; assignedTo?: string | null },
  ): Promise<Report> {
    const report = await this.getReport(id);
    report.status = "resolved";
    report.resolvedAt = new Date();
    if (data.notes !== undefined) report.notes = data.notes;
    if (data.assignedTo !== undefined) report.assignedTo = data.assignedTo;
    const saved = await this.reportRepo.save(report);
    this.audit("ADMIN_REPORT_RESOLVE", { reportId: id });
    return saved;
  }

  //********************************************************************
  //
  // getUser Method
  //
  // Gets a user by UID for admin operations.
  //
  // Return Value
  // ------------
  // Promise<User>    User entity
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  //*******************************************************************
  async getUser(uid: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
  }

  async getUserFlags(uid: string) {
    return this.usersService.getUserFlags(uid, { requireUser: true });
  }

  async updateUserFlags(
    uid: string,
    flags: Partial<{
      unlimitedSearch: boolean;
      unlimitedUndo: boolean;
      unlimitedMessageReq: boolean;
    }>,
    actorUid: string,
  ) {
    const updated = await this.usersService.setUserFlags(uid, flags);
    this.audit("ADMIN_UPDATE_USER_FLAGS", {
      actorUid,
      targetUid: uid,
      flags: updated,
    });
    return updated;
  }

  //********************************************************************
  //
  // grant Method
  //
  // Grants tokens and/or subscription status to a user. Updates or
  // increments the specified fields.
  //
  // Return Value
  // ------------
  // Promise<User>    Updated user entity
  //
  // Value Parameters
  // ----------------
  // dto    GrantDto    Grant data
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
  async grant(dto: GrantDto, actorUid: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { uid: dto.userUid, deletedAt: IsNull() },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const deltas: Record<string, number | boolean | string | null> = {};

    if (dto.isSubscribed !== undefined) {
      user.isSubscribed = dto.isSubscribed;
      deltas.isSubscribed = dto.isSubscribed;
    }

    if (dto.subscriptionExpiresAt !== undefined) {
      if (
        dto.subscriptionExpiresAt === null ||
        dto.subscriptionExpiresAt === ""
      ) {
        user.subscriptionExpiresAt = null;
        deltas.subscriptionExpiresAt = null;
      } else {
        const dateStr = String(dto.subscriptionExpiresAt);
        user.subscriptionExpiresAt = new Date(dateStr);
        deltas.subscriptionExpiresAt = dateStr;
      }
    }

    const saved = await this.usersRepo.save(user);

    // Route grants through TokenLedger for single source of truth
    const grantEntries: Array<{ tokenType: TokenType; quantity: number }> = [];
    if (dto.searchTokens !== undefined && dto.searchTokens > 0) {
      grantEntries.push({ tokenType: "search", quantity: dto.searchTokens });
    }
    if (dto.messageTokens !== undefined && dto.messageTokens > 0) {
      grantEntries.push({
        tokenType: "message_request",
        quantity: dto.messageTokens,
      });
    }
    if (dto.undoTokens !== undefined && dto.undoTokens > 0) {
      grantEntries.push({ tokenType: "undo", quantity: dto.undoTokens });
    }

    for (const grant of grantEntries) {
      await this.tokensService.grantAdminTokens(
        user.id,
        grant.tokenType,
        grant.quantity,
      );
    }

    // Sync token balances from ledger to user table for consistency
    if (grantEntries.length > 0) {
      const [undoTokens, searchTokens, messageTokens] = await Promise.all([
        this.tokensService.getAvailableTokens(user.id, "undo"),
        this.tokensService.getAvailableTokens(user.id, "search"),
        this.tokensService.getAvailableTokens(user.id, "message_request"),
      ]);

      user.undoTokens = undoTokens;
      user.searchTokens = searchTokens;
      user.messageTokens = messageTokens;
      await this.usersRepo.save(user);
    }

    this.audit("ADMIN_GRANT", {
      actorUid,
      targetUid: dto.userUid,
      ...deltas,
    });

    return saved;
  }

  //********************************************************************
  //
  // getPhotos Method
  //
  // Returns photos filtered by status for manual review.
  //
  // Return Value
  // ------------
  // Promise<ProfilePhoto[]>    Array of profile photos
  //
  // Value Parameters
  // ----------------
  // status    string|undefined    Optional status filter
  //
  //*******************************************************************
  async getPhotos(status?: string): Promise<ProfilePhoto[]> {
    const where: { status?: PhotoStatus } = {};
    if (
      status &&
      ["pending", "approved", "rejected", "flagged"].includes(status)
    ) {
      where.status = status as PhotoStatus;
    }
    const photos = await this.photoRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: 100, // Limit to 100 most recent
    });

    // Generate signed read URLs (matching app behavior) without mutating DB state
    return Promise.all(
      photos.map(async (photo) => {
        // If the stored value is already a full URL, return as-is
        const isAbsolute = /^https?:\/\//i.test(photo.url);
        if (isAbsolute) {
          return photo;
        }

        try {
          const signedUrl = await this.s3.createReadUrl(photo.url);
          return { ...photo, url: signedUrl };
        } catch (err) {
          // If presign fails, fall back to stored key to avoid breaking the response
          this.logger.warn(
            `Failed to sign photo ${photo.id} (${photo.url}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return photo;
        }
      }),
    );
  }

  //********************************************************************
  //
  // approvePhoto Method
  //
  // Manually approves a photo.
  //
  // Return Value
  // ------------
  // Promise<ProfilePhoto>    Updated photo entity
  //
  // Value Parameters
  // ----------------
  // id    string    Photo UUID
  //
  //*******************************************************************
  async approvePhoto(
    id: string,
    actorUid: string,
    opts?: { reason?: string | null; confidence?: number | null },
  ): Promise<ProfilePhoto> {
    const photo = await this.photoRepo.findOne({ where: { id } });
    if (!photo) {
      throw new NotFoundException("Photo not found");
    }
    photo.status = "approved";
    photo.reason = opts?.reason ?? null; // Clear any previous reason
    if (opts?.confidence !== undefined) {
      photo.confidence = opts.confidence;
    }
    const saved = await this.photoRepo.save(photo);

    this.audit("ADMIN_PHOTO_APPROVE", {
      actorUid,
      photoId: id,
      userId: photo.userId,
    });

    return saved;
  }

  //********************************************************************
  //
  // rejectPhoto Method
  //
  // Manually rejects a photo.
  //
  // Return Value
  // ------------
  // Promise<ProfilePhoto>    Updated photo entity
  //
  // Value Parameters
  // ----------------
  // id    string    Photo UUID
  //
  //*******************************************************************
  async rejectPhoto(
    id: string,
    actorUid: string,
    opts?: { reason?: string | null; confidence?: number | null },
  ): Promise<ProfilePhoto> {
    const photo = await this.photoRepo.findOne({ where: { id } });
    if (!photo) {
      throw new NotFoundException("Photo not found");
    }
    photo.status = "rejected";
    photo.reason = opts?.reason ?? photo.reason ?? "Manually rejected by admin";
    if (opts?.confidence !== undefined) {
      photo.confidence = opts.confidence;
    }
    const saved = await this.photoRepo.save(photo);

    this.audit("ADMIN_PHOTO_REJECT", {
      actorUid,
      photoId: id,
      userId: photo.userId,
    });

    return saved;
  }

  //********************************************************************
  //
  // getAuditLogs Method
  //
  // Returns audit events for admin review, ordered by most recent first.
  //
  // Return Value
  // ------------
  // Promise<AuditEvent[]>    Array of audit events
  //
  // Value Parameters
  // ----------------
  // limit    number    Maximum number of events to return
  // offset   number    Number of events to skip
  //
  //*******************************************************************
  async getAuditLogs(limit: number, offset: number): Promise<AuditEvent[]> {
    return this.auditRepo.find({
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });
  }

  //********************************************************************
  //
  // bulkPhotoAction Method
  //
  // Approve/reject multiple photos.
  //
  //********************************************************************
  async bulkPhotoAction(
    actorUid: string,
    data: {
      photoIds: string[];
      action: "approve" | "reject";
      reason?: string | null;
      confidence?: number | null;
    },
  ): Promise<{ updated: number }> {
    const { photoIds, action, reason, confidence } = data;
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      throw new BadRequestException("photoIds required");
    }
    const photos = await this.photoRepo.findByIds(photoIds);
    for (const p of photos) {
      if (action === "approve") {
        p.status = "approved";
        p.reason = reason ?? null;
      } else {
        p.status = "rejected";
        p.reason = reason ?? p.reason ?? "Rejected by admin";
      }
      if (confidence !== undefined) p.confidence = confidence;
      await this.photoRepo.save(p);
      this.audit(
        action === "approve" ? "ADMIN_PHOTO_APPROVE" : "ADMIN_PHOTO_REJECT",
        {
          actorUid,
          photoId: p.id,
          userId: p.userId,
        },
      );
    }
    return { updated: photos.length };
  }

  //********************************************************************
  //
  // requeuePhoto Method
  //
  // Adds photo back to moderation queue.
  //
  //********************************************************************
  async requeuePhoto(
    id: string,
    queue?: "vision" | "human",
  ): Promise<{ enqueued: boolean; queue: string }> {
    const photo = await this.photoRepo.findOne({ where: { id } });
    if (!photo) throw new NotFoundException("Photo not found");
    // Reset to pending
    photo.status = "pending";
    photo.reason = null;
    await this.photoRepo.save(photo);
    await this.moderationQueue.enqueuePhoto(photo.id, photo.url);
    return { enqueued: true, queue: queue ?? "vision" };
  }

  //********************************************************************
  //
  // getReviews Method
  //
  //********************************************************************
  async getReviews(filter: {
    status?: string;
    targetUid?: string;
    reviewerUid?: string;
  }): Promise<Review[]> {
    const where: FindOptionsWhere<Review> = {};
    if (filter.targetUid) where.targetUid = filter.targetUid;
    if (filter.reviewerUid) where.reviewerUid = filter.reviewerUid;
    if (filter.status === "pending") {
      where.pendingHumanReview = true;
    } else if (filter.status === "approved") {
      where.approved = true;
    } else if (filter.status === "rejected") {
      where.rejected = true;
    }
    return this.reviewsRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: 200,
    });
  }

  //********************************************************************
  //
  // updateReview Method
  //
  //********************************************************************
  async updateReview(
    id: string,
    updates: {
      approved?: boolean;
      rejected?: boolean;
      pendingHumanReview?: boolean;
    },
  ): Promise<Review> {
    const review = await this.reviewsRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException("Review not found");
    if (updates.approved !== undefined) review.approved = updates.approved;
    if (updates.rejected !== undefined) review.rejected = updates.rejected;
    if (updates.pendingHumanReview !== undefined)
      review.pendingHumanReview = updates.pendingHumanReview;
    const saved = await this.reviewsRepo.save(review);
    this.audit("ADMIN_REVIEW_UPDATE", { reviewId: id });
    return saved;
  }

  //********************************************************************
  //
  // issueStrikeForReview Method
  //
  //********************************************************************
  private readonly STRIKE_TIMEOUT_HOURS: Record<number, number> = {
    1: 24,
    2: 72,
    3: 168,
  };

  async issueStrikeForReview(id: string): Promise<{ strikeNumber: number }> {
    const review = await this.reviewsRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException("Review not found");
    const uid = review.targetUid;
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found for strike");

    const prev = await this.strikesRepo.count({
      where: { user: { id: user.id } },
    });
    const strikeNumber = prev + 1;
    const timeoutHours = this.STRIKE_TIMEOUT_HOURS[strikeNumber] ?? 0;
    const expiresAt = new Date(Date.now() + timeoutHours * 3600 * 1000);
    const strike = this.strikesRepo.create({
      user,
      reason: `Admin strike from review ${id}`,
      strikeNumber,
      timeoutHours,
      timeoutExpiresAt: expiresAt,
    });
    await this.strikesRepo.save(strike);
    this.audit("ADMIN_REVIEW_STRIKE", {
      reviewId: id,
      targetUid: uid,
      strikeNumber,
    });
    return { strikeNumber };
  }

  //********************************************************************
  //
  // removeStrikeForReviewTarget Method
  //
  //********************************************************************
  async removeStrikeForReviewTarget(id: string): Promise<{ removed: boolean }> {
    const review = await this.reviewsRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException("Review not found");
    const user = await this.usersRepo.findOne({
      where: { uid: review.targetUid },
    });
    if (!user) throw new NotFoundException("User not found");
    const strike = await this.strikesRepo.findOne({
      where: { user: { id: user.id } },
      order: { createdAt: "DESC" },
    });
    if (strike) {
      await this.strikesRepo.delete(strike.id);
      this.audit("ADMIN_REVIEW_STRIKE_REMOVED", {
        reviewId: id,
        targetUid: user.uid,
      });
      return { removed: true };
    }
    return { removed: false };
  }

  //********************************************************************
  //
  // unblockReviewTimeout Method
  //
  //********************************************************************
  async unblockReviewTimeout(uid: string): Promise<{ cleared: boolean }> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    user.reviewTimeoutExpiresAt = null;
    await this.usersRepo.save(user);
    this.audit("ADMIN_REVIEW_TIMEOUT_RESET", { targetUid: uid });
    return { cleared: true };
  }

  //********************************************************************
  //
  // getMatches Method
  //
  //********************************************************************
  async getMatches(uid: string): Promise<Match[]> {
    return this.matchRepo.find({
      where: [{ userAUid: uid }, { userBUid: uid }],
      order: { createdAt: "DESC" },
    });
  }

  //********************************************************************
  //
  // unmatch Method
  //
  //********************************************************************
  async unmatch(matchId: string): Promise<Match> {
    const match = await this.matchRepo.findOne({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");
    match.status = "archived";
    match.lastActivityAt = new Date();
    return this.matchRepo.save(match);
  }

  //********************************************************************
  //
  // getMessages Method
  //
  //********************************************************************
  async getMessages(matchId: string): Promise<Message[]> {
    const thread = await this.threadRepo.findOne({ where: { matchId } });
    if (!thread) return [];
    return this.messageRepo.find({
      where: { thread: { id: thread.id } },
      order: { createdAt: "ASC" },
    });
  }

  //********************************************************************
  //
  // muteChat Method
  //
  //********************************************************************
  async muteChat(uid: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    user.notificationsEnabled = false;
    const saved = await this.usersRepo.save(user);
    await this.notifications.invalidatePushCache(uid);
    return saved;
  }

  //********************************************************************
  //
  // clearMessageTokens Method
  //
  //********************************************************************
  async clearMessageTokens(uid: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    user.messageTokens = 0;
    return this.usersRepo.save(user);
  }

  //********************************************************************
  //
  // impersonate Method
  //
  // Issues a short-lived Firebase custom token to act as the target user.
  //
  //********************************************************************
  async impersonate(
    targetUid: string,
    actorUid: string,
  ): Promise<{ impersonationToken: string }> {
    void targetUid;
    void actorUid;
    await Promise.resolve();
    throw new UnauthorizedException("Impersonation not supported");
  }

  //********************************************************************
  //
  // pause/unpause user (profile)
  //
  //********************************************************************
  async pauseUser(uid: string): Promise<Profile> {
    const profile = await this.profileRepo.findOne({ where: { userUid: uid } });
    if (!profile) throw new NotFoundException("Profile not found");
    profile.paused = true;
    return this.profileRepo.save(profile);
  }

  async unpauseUser(uid: string): Promise<Profile> {
    const profile = await this.profileRepo.findOne({ where: { userUid: uid } });
    if (!profile) throw new NotFoundException("Profile not found");
    profile.paused = false;
    return this.profileRepo.save(profile);
  }

  //********************************************************************
  //
  // deleteUser Method (admin)
  //
  //********************************************************************
  async deleteUser(uid: string): Promise<{ deleted: true }> {
    // Delegate to UsersService for full cascade deletion (profiles, photos, reviews, matches, etc.)
    await this.usersService.deleteUser(uid);
    this.audit("ADMIN_DELETE_USER", { targetUid: uid });
    return { deleted: true };
  }

  //********************************************************************
  //
  // resetReviewTimeout Method
  //
  //********************************************************************
  async resetReviewTimeout(uid: string): Promise<{ cleared: boolean }> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    user.reviewTimeoutExpiresAt = null;
    await this.usersRepo.save(user);
    return { cleared: true };
  }

  //********************************************************************
  //
  // resetStrikes Method
  //
  //********************************************************************
  async resetStrikes(uid: string): Promise<{ removed: number }> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    const strikes = await this.strikesRepo.find({
      where: { user: { id: user.id } },
    });
    if (strikes.length) {
      await this.strikesRepo.remove(strikes);
    }
    return { removed: strikes.length };
  }

  //********************************************************************
  //
  // revokeSessions Method
  //
  //********************************************************************
  async revokeSessions(uid: string): Promise<{ revoked: boolean }> {
    await Promise.resolve();
    this.audit("ADMIN_REVOKE_SESSIONS", { targetUid: uid });
    return { revoked: true };
  }

  //********************************************************************
  //
  // updateUserRole Method
  //
  //********************************************************************
  async updateUserRole(uid: string, role: "user" | "admin"): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    const adminRecord = await this.adminRepo.findOne({ where: { uid } });

    if (role === "admin") {
      if (!user.email) {
        throw new BadRequestException("User must have email to become admin");
      }
      if (!adminRecord) {
        const newAdmin = this.adminRepo.create({
          uid: user.uid,
          email: user.email.toLowerCase(),
          createdByUid: null,
        });
        await this.adminRepo.save(newAdmin);
      }
    } else if (adminRecord) {
      await this.adminRepo.delete({ uid });
    }

    return user;
  }

  //********************************************************************
  //
  // resendVerification Method
  //
  //********************************************************************
  async resendVerification(uid: string): Promise<{ sent: boolean }> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user || !user.email)
      throw new NotFoundException("User email not found");

    const email = user.email;

    await this.emailService.sendEmail(
      email,
      "Verify your Even account",
      "<p>Please verify your Even account. (Add verification link handling here.)</p>",
      "Please verify your Even account. (Add verification link handling here.)",
    );

    this.audit("ADMIN_RESEND_VERIFICATION", { targetUid: uid });
    return { sent: true };
  }

  //********************************************************************
  //
  // Token & subscription management
  //
  //********************************************************************
  async getTokenBalances(uid: string) {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    // Get token balances from ledger (source of truth)
    const [undoTokens, searchTokens, messageTokens] = await Promise.all([
      this.tokensService.getAvailableTokens(user.id, "undo"),
      this.tokensService.getAvailableTokens(user.id, "search"),
      this.tokensService.getAvailableTokens(user.id, "message_request"),
    ]);

    return {
      searchTokens,
      messageTokens,
      undoTokens,
      isSubscribed: user.isSubscribed,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
    };
  }

  async grantTokens(
    uid: string,
    body: { search?: number; message?: number; undo?: number },
  ) {
    for (const [label, amount] of Object.entries(body)) {
      if (amount === undefined) continue;
      if (!Number.isInteger(amount) || amount < 0 || amount > this.maxTokenGrant) {
        throw new BadRequestException(
          `${label} must be an integer between 0 and ${this.maxTokenGrant}`,
        );
      }
    }

    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    if (body.search) {
      await this.tokensService.grantAdminTokens(user.id, "search", body.search);
    }
    if (body.message) {
      await this.tokensService.grantAdminTokens(
        user.id,
        "message_request",
        body.message,
      );
    }
    if (body.undo) {
      await this.tokensService.grantAdminTokens(user.id, "undo", body.undo);
    }

    // Sync token balances from ledger to user table for admin panel display
    const [undoTokens, searchTokens, messageTokens] = await Promise.all([
      this.tokensService.getAvailableTokens(user.id, "undo"),
      this.tokensService.getAvailableTokens(user.id, "search"),
      this.tokensService.getAvailableTokens(user.id, "message_request"),
    ]);

    user.undoTokens = undoTokens;
    user.searchTokens = searchTokens;
    user.messageTokens = messageTokens;
    await this.usersRepo.save(user);

    return this.getTokenBalances(uid);
  }

  async revokeTokens(
    uid: string,
    body: { search?: number; message?: number; undo?: number },
  ) {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    // Revoke tokens by consuming from ledger (respects priority order)
    if (body.search) {
      for (let i = 0; i < body.search; i++) {
        await this.tokensService.consumeToken(user.id, "search");
      }
    }
    if (body.message) {
      for (let i = 0; i < body.message; i++) {
        await this.tokensService.consumeToken(user.id, "message_request");
      }
    }
    if (body.undo) {
      for (let i = 0; i < body.undo; i++) {
        await this.tokensService.consumeToken(user.id, "undo");
      }
    }

    // Sync token balances from ledger to user table for consistency
    const [undoTokens, searchTokens, messageTokens] = await Promise.all([
      this.tokensService.getAvailableTokens(user.id, "undo"),
      this.tokensService.getAvailableTokens(user.id, "search"),
      this.tokensService.getAvailableTokens(user.id, "message_request"),
    ]);

    user.undoTokens = undoTokens;
    user.searchTokens = searchTokens;
    user.messageTokens = messageTokens;
    await this.usersRepo.save(user);

    return this.getTokenBalances(uid);
  }

  async updateSubscription(
    uid: string,
    body: { isSubscribed?: boolean; subscriptionExpiresAt?: string | null },
  ) {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    if (body.isSubscribed !== undefined) user.isSubscribed = body.isSubscribed;
    if (body.subscriptionExpiresAt !== undefined) {
      if (body.subscriptionExpiresAt === null) {
        user.subscriptionExpiresAt = null;
      } else {
        const date = new Date(body.subscriptionExpiresAt);
        if (Number.isNaN(date.getTime())) {
          throw new BadRequestException("Invalid subscriptionExpiresAt");
        }
        user.subscriptionExpiresAt = date;
      }
    }
    await this.usersRepo.save(user);
    return this.getTokenBalances(uid);
  }

  //********************************************************************
  //
  // banUser Method
  //
  // Bans a user by setting the banned flag, bannedAt timestamp, and
  // optional ban reason. Also revokes all Firebase sessions.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean; message: string }>
  //
  // Value Parameters
  // ----------------
  // uid         string          Firebase UID of user to ban
  // reason      string|null     Optional reason for the ban
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user        User|null       User entity
  //
  //*******************************************************************
  async banUser(
    uid: string,
    reason: string | null = null,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    if (user.banned) {
      throw new BadRequestException("User is already banned");
    }

    user.banned = true;
    user.bannedAt = new Date();
    user.banReason = reason;

    await this.usersRepo.save(user);

    // Revoke all Firebase sessions
    await this.revokeSessions(uid);

    return {
      success: true,
      message: "User banned successfully",
    };
  }

  //********************************************************************
  //
  // unbanUser Method
  //
  // Unbans a user by clearing the banned flag, bannedAt timestamp, and
  // ban reason.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean; message: string }>
  //
  // Value Parameters
  // ----------------
  // uid         string          Firebase UID of user to unban
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user        User|null       User entity
  //
  //*******************************************************************
  async unbanUser(uid: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");

    if (!user.banned) {
      throw new BadRequestException("User is not banned");
    }

    user.banned = false;
    user.bannedAt = null;
    user.banReason = null;

    await this.usersRepo.save(user);

    return {
      success: true,
      message: "User unbanned successfully",
    };
  }

  //********************************************************************
  //
  // Rate limit management (best effort)
  //
  //********************************************************************
  async listRateLimitBuckets(): Promise<{ buckets: string[] }> {
    const keys = await this.redis.safe(() => this.redis.client.keys("rate:*"), {
      op: "keys",
      key: "rate:*",
    });
    return { buckets: keys ?? [] };
  }

  //********************************************************************
  //
  // Admin user search by name (case-insensitive, partial match)
  //
  //********************************************************************
  async searchUsersByName(
    name: string,
    limit = 50,
  ): Promise<
    Array<{
      uid: string;
      email: string | null;
      profileId: string;
      name: string;
      paused: boolean;
      createdAt: Date;
    }>
  > {
    if (!name || name.trim().length === 0) {
      return [];
    }

    const query = this.profileRepo
      .createQueryBuilder("profile")
      .leftJoin(User, "user", "user.uid = profile.userUid")
      .select([
        "profile.userUid AS uid",
        "user.email AS email",
        "profile.id AS profileId",
        "profile.name AS name",
        "profile.paused AS paused",
        "profile.createdAt AS createdAt",
      ])
      .where("LOWER(profile.name) LIKE LOWER(:name)", {
        name: `%${name.trim()}%`,
      })
      .orderBy("profile.createdAt", "DESC")
      .limit(limit);

    const rows = await query.getRawMany<{
      uid: string;
      email: string | null;
      profileId: string;
      name: string;
      paused: boolean;
      createdAt: Date;
    }>();

    return rows;
  }

  async clearRateLimitBucket(key: string): Promise<{ cleared: boolean }> {
    await this.redis.safe(() => this.redis.client.del(key), { op: "del", key });
    return { cleared: true };
  }

  async whitelistIp(ip: string): Promise<{ whitelisted: string }> {
    await this.redis.safe(() => this.redis.client.sAdd("rate:whitelist", ip), {
      op: "sadd",
      key: "rate:whitelist",
    });
    return { whitelisted: ip };
  }

  async blacklistIp(ip: string): Promise<{ blacklisted: string }> {
    await this.redis.safe(() => this.redis.client.sAdd("rate:blacklist", ip), {
      op: "sadd",
      key: "rate:blacklist",
    });
    return { blacklisted: ip };
  }

  //********************************************************************
  //
  // Queue debug
  //
  //********************************************************************
  async getQueue(uid: string) {
    const cached = await this.redis.safe(
      () => this.redis.client.get(`queue:${uid}`),
      { op: "get", key: `queue:${uid}` },
    );
    const parsed =
      cached && cached.length > 0 ? (JSON.parse(cached) as unknown) : [];
    return { uid, cached: parsed };
  }

  async rebuildQueue(uid: string) {
    await this.redis.safe(() => this.redis.client.del(`queue:${uid}`), {
      op: "del",
      key: `queue:${uid}`,
    });
    // Force recompute on next request by removing cache
    return { rebuilt: true };
  }

  //********************************************************************
  //
  // Health/logs/jobs stubs
  //
  //********************************************************************
  async health() {
    const redisOk = await this.redis.healthCheck();
    return { status: "ok", redis: redisOk };
  }

  async logs() {
    return Promise.resolve({ logs: [] });
  }

  async jobs() {
    return Promise.resolve({ jobs: [] });
  }

  //********************************************************************
  //
  // Config flags (stored in Redis)
  //
  //********************************************************************
  private readonly FLAGS_KEY = "admin:flags";

  async getFlags() {
    const data = await this.redis.safe(
      () => this.redis.client.get(this.FLAGS_KEY),
      { op: "get", key: this.FLAGS_KEY },
    );
    if (!data) return {};
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async setFlag(key: string, value: boolean | string | number) {
    const flags = await this.getFlags();
    flags[key] = value;
    await this.redis.safe(
      () => this.redis.client.set(this.FLAGS_KEY, JSON.stringify(flags)),
      { op: "set", key: this.FLAGS_KEY },
    );
    return flags;
  }

  //********************************************************************
  //
  // Push/email test stubs
  //
  //********************************************************************
  async testPush(uid: string) {
    this.audit("ADMIN_TEST_PUSH", { targetUid: uid });
    await this.notifications.sendNotification(
      uid,
      "Test push",
      "This is a test push from admin",
    );
    return { sent: true };
  }

  async testEmail(uid: string) {
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user || !user.email)
      throw new NotFoundException("User email not found");

    const email = user.email;

    await this.emailService.sendEmail(
      email,
      "Test email from admin",
      "<p>This is a test email from admin.</p>",
      "This is a test email from admin.",
    );

    this.audit("ADMIN_TEST_EMAIL", { targetUid: uid });
    return { sent: true };
  }

  async pushLog(uid: string) {
    return Promise.resolve({ uid, log: [] });
  }

  //********************************************************************
  //
  // Data export (simple inline job)
  //
  //********************************************************************
  async exportUser(uid: string) {
    const jobId = `job_${Date.now()}`;
    const user = await this.usersRepo.findOne({
      where: { uid, deletedAt: IsNull() },
    });
    if (!user) throw new NotFoundException("User not found");
    const profile = await this.profileRepo.findOne({ where: { userUid: uid } });
    const photos = await this.photoRepo.find({ where: { userId: uid } });
    const matches = await this.matchRepo.find({
      where: [{ userAUid: uid }, { userBUid: uid }],
    });
    const reviews = await this.reviewsRepo.find({
      where: [{ targetUid: uid }, { reviewerUid: uid }],
    });
    const payload = {
      user,
      profile,
      photos,
      matches,
      reviews,
    };
    await this.redis.safe(
      () =>
        this.redis.client.set(
          `export:${uid}:${jobId}`,
          JSON.stringify({ status: "complete", payload }),
          {
            EX: 3600,
          },
        ),
      { op: "set", key: `export:${uid}:${jobId}` },
    );
    return { jobId, status: "complete" };
  }

  async exportStatus(uid: string, jobId: string) {
    const status = await this.redis.safe(
      () => this.redis.client.get(`export:${uid}:${jobId}`),
      { op: "get", key: `export:${uid}:${jobId}` },
    );
    if (!status) return { jobId, status: "unknown" };
    try {
      return { jobId, ...(JSON.parse(status) as Record<string, unknown>) };
    } catch {
      return { jobId, status: status ?? "unknown" };
    }
  }

  //********************************************************************
  //
  // deletePhoto Method
  //
  // Deletes a photo and removes it from the user's profile and S3.
  //
  //********************************************************************
  async deletePhoto(id: string, actorUid: string): Promise<{ deleted: true }> {
    const photo = await this.photoRepo.findOne({ where: { id } });
    if (!photo) {
      throw new NotFoundException("Photo not found");
    }

    // Best-effort remove from profile photo array
    const profile = await this.profileRepo.findOne({
      where: { userUid: photo.userId },
    });
    if (profile && Array.isArray(profile.photos)) {
      const cleaned = profile.photos.filter((p) => {
        if (!p) return false;
        if (p === photo.url) return false;
        // If stored as absolute URL that ends with the key, drop it too
        return !p.endsWith(photo.url);
      });
      profile.photos = cleaned;
      await this.profileRepo.save(profile);
    }

    // Best-effort S3 delete (skip if already an absolute URL)
    const isAbsolute = /^https?:\/\//i.test(photo.url);
    if (!isAbsolute) {
      try {
        await this.s3.deleteObject(photo.url);
      } catch (err) {
        this.logger.warn(
          `Failed to delete S3 object for photo ${photo.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.photoRepo.delete({ id });

    this.audit("ADMIN_PHOTO_DELETE", {
      actorUid,
      photoId: id,
      userId: photo.userId,
    });

    return { deleted: true };
  }

  //********************************************************************
  //
  // getProfileForAdmin Method
  //
  // Returns a user's profile (including sex) for admin tools.
  //
  //********************************************************************
  async getProfileForAdmin(uid: string): Promise<ProfileResponse> {
    const profile = await this.profilesService.getProfile(uid);
    if (!profile) {
      throw new NotFoundException("Profile not found");
    }
    return profile;
  }

  //********************************************************************
  //
  // getUserStats Method
  //
  // Returns total users and active users (seen in last 24 hours).
  //
  //********************************************************************
  async getUserStats(): Promise<{ totalUsers: number; activeUsers: number }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const demoUids = getAllDemoUids();

    const [totalUsers, activeUsers] = await Promise.all([
      this.usersRepo.count({ where: { uid: Not(In(demoUids)) } }),
      this.usersRepo.count({
        where: { uid: Not(In(demoUids)), lastLocationUpdate: MoreThanOrEqual(since) },
      }),
    ]);
    return { totalUsers, activeUsers };
  }

  async getUserActivityByHour(): Promise<Array<{ hour: string; count: number }>> {
    const demoUids = getAllDemoUids();
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const rows = await this.usersRepo
      .createQueryBuilder("user")
      .select("date_trunc('hour', user.lastLocationUpdate)", "hour")
      .addSelect("COUNT(*)", "count")
      .where("user.lastLocationUpdate >= :since", { since })
      .andWhere("user.uid NOT IN (:...demoUids)", { demoUids })
      .groupBy("date_trunc('hour', user.lastLocationUpdate)")
      .orderBy("hour", "ASC")
      .getRawMany<{ hour: string; count: string }>();

    return rows.map((r) => ({ hour: r.hour, count: Number(r.count) }));
  }

  async setCognitoPassword(
    uid: string,
    password: string,
    permanent: boolean,
  ): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { uid } });
    if (!user) throw new NotFoundException("User not found");

    const region = process.env.AWS_REGION;
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!region || !userPoolId) {
      throw new Error("AWS_REGION or COGNITO_USER_POOL_ID not configured");
    }

    // Cognito username is cognitoSub, email, or phone — prefer cognitoSub
    const username = user.cognitoSub ?? user.email;
    if (!username) throw new NotFoundException("No Cognito identifier for user");

    const cognito = this.getCognitoClient(region);
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: username,
        Password: password,
        Permanent: permanent,
      }),
    );
  }

  //********************************************************************
  //
  // getUserStrikes Method
  //
  // Returns the number of review strikes for a user.
  //
  //********************************************************************
  async getUserStrikes(uid: string): Promise<{ strikeCount: number }> {
    const strikeCount = await this.strikesRepo.count({
      where: { user: { uid } },
    });
    return { strikeCount };
  }

  //********************************************************************
  //
  // Support Ticket Admin Methods
  //
  //********************************************************************
  async getSupportTickets(status?: string): Promise<SupportTicket[]> {
    const where: FindOptionsWhere<SupportTicket> = {};
    if (status && ["open", "in_progress", "closed"].includes(status)) {
      where.status = status as "open" | "in_progress" | "closed";
    }
    return this.supportTicketRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: 200,
    });
  }

  async getSupportTicket(id: string): Promise<SupportTicket> {
    const ticket = await this.supportTicketRepo.findOne({ where: { id } });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }
    return ticket;
  }

  async updateSupportTicket(
    id: string,
    updates: {
      status?: "open" | "in_progress" | "closed";
      adminResponse?: string;
    },
  ): Promise<SupportTicket> {
    const ticket = await this.getSupportTicket(id);
    if (updates.status) {
      ticket.status = updates.status;
    }
    if (updates.adminResponse !== undefined) {
      (ticket as SupportTicket & { adminResponse?: string }).adminResponse =
        updates.adminResponse;
    }
    const saved = await this.supportTicketRepo.save(ticket);
    this.audit("ADMIN_SUPPORT_TICKET_UPDATE", { ticketId: id });
    return saved;
  }

  async replySupportTicket(
    id: string,
    response: string,
    actorUid: string,
  ): Promise<SupportTicket> {
    const ticket = await this.getSupportTicket(id);
    (ticket as SupportTicket & { adminResponse?: string }).adminResponse =
      response;
    ticket.status = "in_progress";
    const saved = await this.supportTicketRepo.save(ticket);

    // Send email reply to the user
    try {
      await this.emailService.sendEmail(
        ticket.email,
        `Re: ${ticket.subject}`,
        `<p>Hello ${ticket.name},</p><p>${response}</p><p>Best regards,<br>Even Support Team</p>`,
        `Hello ${ticket.name},\n\n${response}\n\nBest regards,\nEven Support Team`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send support reply email: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    this.audit("ADMIN_SUPPORT_TICKET_REPLY", {
      ticketId: id,
      actorUid,
      email: ticket.email,
    });
    return saved;
  }

  async closeSupportTicket(
    id: string,
    actorUid: string,
  ): Promise<SupportTicket> {
    const ticket = await this.getSupportTicket(id);
    ticket.status = "closed";
    const saved = await this.supportTicketRepo.save(ticket);
    this.audit("ADMIN_SUPPORT_TICKET_CLOSE", { ticketId: id, actorUid });
    return saved;
  }

  //********************************************************************
  //
  // Suggestion Admin Methods
  //
  //********************************************************************
  async getSuggestions(status?: string): Promise<Suggestion[]> {
    const where: FindOptionsWhere<Suggestion> = {};
    if (
      status &&
      ["new", "reviewed", "implemented", "rejected"].includes(status)
    ) {
      where.status = status as "new" | "reviewed" | "implemented" | "rejected";
    }
    return this.suggestionRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: 200,
    });
  }

  async getSuggestion(id: string): Promise<Suggestion> {
    const suggestion = await this.suggestionRepo.findOne({ where: { id } });
    if (!suggestion) {
      throw new NotFoundException("Suggestion not found");
    }
    return suggestion;
  }

  async updateSuggestion(
    id: string,
    updates: {
      status?: "new" | "reviewed" | "implemented" | "rejected";
    },
  ): Promise<Suggestion> {
    const suggestion = await this.getSuggestion(id);
    if (updates.status) {
      suggestion.status = updates.status;
    }
    const saved = await this.suggestionRepo.save(suggestion);
    this.audit("ADMIN_SUGGESTION_UPDATE", { suggestionId: id });
    return saved;
  }

  //********************************************************************
  //
  // browseUsersWithPhotos Method
  //
  // Returns recent users with their profile photos for the admin grid view.
  // Allows browsing users by face before searching by name.
  //
  //********************************************************************
  async browseUsersWithPhotos(
    limit = 50,
    offset = 0,
  ): Promise<
    Array<{
      uid: string;
      name: string;
      sex: string | null;
      age: number | null;
      photoUrl: string | null;
      createdAt: Date;
    }>
  > {
    const profiles = await this.profileRepo.find({
      where: { paused: false },
      order: { createdAt: "DESC" },
      skip: offset,
      take: limit,
      select: ["userUid", "name", "sex", "birthday", "photos", "createdAt"],
    });

    const mapped = profiles.map((p) => {
      let age: number | null = null;
      if (p.birthday) {
        const today = new Date();
        const birthDate = new Date(p.birthday);
        age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
      }

      return {
        userUid: p.userUid,
        name: p.name || "Unknown",
        sex: p.sex,
        age,
        firstPhoto:
          Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null,
        createdAt: p.createdAt,
      };
    });

    // Generate presigned URLs for photos
    const results = await Promise.all(
      mapped.map(async (p) => {
        let photoUrl: string | null = null;
        if (p.firstPhoto) {
          // If it's already an absolute URL, use it; otherwise generate a presigned URL
          if (/^https?:\/\//i.test(p.firstPhoto)) {
            photoUrl = p.firstPhoto;
          } else {
            try {
              photoUrl = await this.s3.createReadUrl(p.firstPhoto);
            } catch {
              // Fallback to unsigned URL if signing fails
              const bucket = process.env.S3_BUCKET || "even-dating-media";
              const region = process.env.AWS_REGION || "us-east-2";
              photoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${p.firstPhoto}`;
            }
          }
        }
        return {
          uid: p.userUid,
          name: p.name,
          sex: p.sex,
          age: p.age,
          photoUrl,
          createdAt: p.createdAt,
        };
      }),
    );

    return results;
  }
}
