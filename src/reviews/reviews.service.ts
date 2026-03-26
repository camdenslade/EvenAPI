//********************************************************************
//
// ReviewsService Class
//
// Service for managing user reviews. Handles review creation with
// validation rules, weekly limits (3 reviews per week), emergency
// reviews, report reviews, keyword moderation, strike system, and
// review queries. Implements strict chat validation requirements
// for different review types.
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
// WEEK_MS              number                    Week duration in milliseconds
// STRIKE_TIMEOUT_HOURS Record<number,number>     Strike timeout hours by strike number
// FLAGGED_WORDS        string[]                  Array of flagged words for moderation
// reviewsRepo          Repository<Review>        TypeORM repository for reviews
// strikesRepo          Repository<ReviewStrike>  TypeORM repository for review strikes
// weekRepo             Repository<ReviewWeekWindow> TypeORM repository for weekly windows
// emergencyRepo        Repository<ReviewEmergency>  TypeORM repository for emergency reviews
// users                UsersService              Users service
// chat                 ChatService               Chat service for message validation
//
//*******************************************************************

import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { Review } from "../database/entities/review.entity";
import { ReviewStrike } from "../database/entities/review-strike.entity";
import { ReviewWeekWindow } from "../database/entities/review-week-window.entity";
import { ReviewEmergency } from "../database/entities/review-emergency.entity";
import { Message } from "../database/entities/message.entity";
import { Match } from "../database/entities/match.entity";

import { UsersService } from "../users/users.service";
import { ChatService } from "../chat/chat.service";

import { FLAGGED_WORDS } from "./keywords";

interface CreateReviewDto {
  reviewerUid: string;
  targetUid: string;
  rating: number;
  comment: string;
  type: "normal" | "emergency" | "report";
  phoneNumberSnapshot?: string | null;
  reportCategory?: string | null;
  photos?: string[];
}

@Injectable()
export class ReviewsService {
  private readonly WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  private readonly STRIKE_TIMEOUT_HOURS: Record<number, number> = {
    1: 24,
    2: 72,
    3: 168,
  };

  private readonly FLAGGED_WORDS = FLAGGED_WORDS;

  constructor(
    @InjectRepository(Review)
    private readonly reviewsRepo: Repository<Review>,

    @InjectRepository(ReviewStrike)
    private readonly strikesRepo: Repository<ReviewStrike>,

    @InjectRepository(ReviewWeekWindow)
    private readonly weekRepo: Repository<ReviewWeekWindow>,

    @InjectRepository(ReviewEmergency)
    private readonly emergencyRepo: Repository<ReviewEmergency>,

    @InjectRepository(Match)
    private readonly matchesRepo: Repository<Match>,

    private readonly users: UsersService,
    private readonly chat: ChatService,
  ) {}

  //********************************************************************
  //
  // alreadyReviewed Function
  //
  // Checks if a reviewer has already reviewed a target user.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if review already exists
  //
  // Value Parameters
  // ----------------
  // reviewerUid    string    Firebase UID of reviewer
  // targetUid      string    Firebase UID of target
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // existing    Review|null    Existing review or null
  //
  //*******************************************************************
  private async alreadyReviewed(
    reviewerUid: string,
    targetUid: string,
  ): Promise<boolean> {
    const existing = await this.reviewsRepo.findOne({
      where: { reviewerUid, targetUid },
    });
    return existing !== null;
  }

  private async ensureUsersMatched(
    reviewerUid: string,
    targetUid: string,
  ): Promise<void> {
    const match = await this.matchesRepo.findOne({
      where: [
        { userAUid: reviewerUid, userBUid: targetUid },
        { userAUid: targetUid, userBUid: reviewerUid },
      ],
    });

    if (!match || match.status === "expired") {
      throw new ForbiddenException("You can only review matched users.");
    }
  }

  //********************************************************************
  //
  // containsFlaggedWord Function
  //
  // Checks if a comment contains any flagged words for moderation.
  //
  // Return Value
  // ------------
  // boolean    True if flagged word found
  //
  // Value Parameters
  // ----------------
  // comment    string    Review comment text
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // lower    string    Lowercase comment text
  // w        string    Flagged word in loop
  //
  //*******************************************************************
  private containsFlaggedWord(comment: string): boolean {
    const lower = comment.toLowerCase();
    return this.FLAGGED_WORDS.some((w) => lower.includes(w));
  }

  //********************************************************************
  //
  // issueStrike Method
  //
  // Issues a strike to a user for review violations. Applies timeout
  // based on strike number. Issues system penalty review on 3rd strike.
  //
  // Return Value
  // ------------
  // Promise<number>    Strike number issued
  //
  // Value Parameters
  // ----------------
  // uid     string    Firebase UID of user to strike
  // reason  string    Reason for the strike
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user            User|null        User entity
  // prev            number           Previous strike count
  // strikeNumber    number           New strike number
  // timeoutHours    number           Timeout hours for this strike
  // expiresAt       Date             Timeout expiration date
  // strike          ReviewStrike     Created strike entity
  // penalty         Review           System penalty review entity
  //
  //*******************************************************************
  private async issueStrike(uid: string, reason: string): Promise<number> {
    const user = await this.users.getByUid(uid);
    if (!user) throw new NotFoundException("User not found for strike");

    const prev = await this.strikesRepo.count({ where: { user: { uid } } });
    const strikeNumber = prev + 1;

    const timeoutHours = this.STRIKE_TIMEOUT_HOURS[strikeNumber] ?? 0;
    const expiresAt = new Date(Date.now() + timeoutHours * 3600 * 1000);

    const strike = this.strikesRepo.create({
      user,
      reason,
      strikeNumber,
      timeoutHours,
      timeoutExpiresAt: expiresAt,
    });

    await this.strikesRepo.save(strike);

    if (strikeNumber === 3) {
      const penalty = this.reviewsRepo.create({
        reviewerUid: "SYSTEM",
        targetUid: uid,
        rating: 2,
        comment: "System penalty for repeated abusive reviews.",
        type: "normal",
        approved: true,
      });
      await this.reviewsRepo.save(penalty);
    }

    return strikeNumber;
  }

  //********************************************************************
  //
  // getOrCreateWeekWindow Method
  //
  // Gets or creates a weekly review window for a user. Resets window
  // if it has expired.
  //
  // Return Value
  // ------------
  // Promise<ReviewWeekWindow>    Weekly window entity
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
  // user      User|null              User entity
  // now       Date                   Current timestamp
  // existing  ReviewWeekWindow|null  Existing window or null
  // window    ReviewWeekWindow       Newly created window entity
  //
  //*******************************************************************
  private async getOrCreateWeekWindow(uid: string): Promise<ReviewWeekWindow> {
    const user = await this.users.getByUid(uid);
    if (!user) throw new NotFoundException("User not found");

    const now = new Date();

    const existing = await this.weekRepo.findOne({
      where: { user: { id: user.id } },
    });

    if (!existing) {
      const window = this.weekRepo.create({
        user,
        windowStart: now,
        windowEnd: new Date(now.getTime() + this.WEEK_MS),
        reviewsUsed: 0,
      });
      return this.weekRepo.save(window);
    }

    if (now > existing.windowEnd) {
      existing.windowStart = now;
      existing.windowEnd = new Date(now.getTime() + this.WEEK_MS);
      existing.reviewsUsed = 0;
      return this.weekRepo.save(existing);
    }

    return existing;
  }

  //********************************************************************
  //
  // getSenderUidFromMessage Function
  //
  // Gets Firebase UID from a Message entity. Uses senderProfile if available,
  // falls back to senderId resolution for backward compatibility.
  //
  // Return Value
  // ------------
  // Promise<string | null>    Firebase UID or null
  //
  // Value Parameters
  // ----------------
  // message    Message    Message entity
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // senderProfile    Profile|null    Sender's profile entity
  // user             User|null       User entity (for fallback)
  //
  //*******************************************************************
  private getSenderUidFromMessage(message: Message): string | null {
    return message.senderProfile?.userUid ?? null;
  }

  //********************************************************************
  //
  // hasTwoWayChat Function
  //
  // Requires both users to have sent >=2 messages each. Used for
  // normal review validation.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if both users sent at least 2 messages
  //
  // Value Parameters
  // ----------------
  // aUid    string    Firebase UID of first user
  // bUid    string    Firebase UID of second user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // msgs      Message[]    Messages between users
  // fromA     number       Message count from user A
  // fromB     number       Message count from user B
  // m         Message      Message in loop
  // senderUid string|null  Sender's Firebase UID
  //
  //*******************************************************************
  private async hasTwoWayChat(aUid: string, bUid: string): Promise<boolean> {
    const msgs = await this.chat.getMessagesBetweenUsers(aUid, bUid);
    if (msgs.length === 0) return false;

    let fromA = 0;
    let fromB = 0;

    for (const m of msgs) {
      const senderUid = this.getSenderUidFromMessage(m);
      if (senderUid === aUid) fromA++;
      if (senderUid === bUid) fromB++;
    }

    return fromA >= 2 && fromB >= 2;
  }

  //********************************************************************
  //
  // hasReceivedOneMessage Function
  //
  // Reviewer must have received at least ONE message from target.
  // Used for report review validation.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if reviewer received at least one message
  //
  // Value Parameters
  // ----------------
  // reviewerUid    string    Firebase UID of reviewer
  // targetUid      string    Firebase UID of target
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // msgs      Message[]    Messages between users
  // m         Message      Message in loop
  // senderUid string|null  Sender's Firebase UID
  //
  //*******************************************************************
  private async hasReceivedOneMessage(
    reviewerUid: string,
    targetUid: string,
  ): Promise<boolean> {
    const msgs = await this.chat.getMessagesBetweenUsers(
      reviewerUid,
      targetUid,
    );

    for (const m of msgs) {
      const senderUid = this.getSenderUidFromMessage(m);
      if (senderUid === targetUid) return true;
    }

    return false;
  }

  //********************************************************************
  //
  // getEmergencyRecord Function
  //
  // Gets emergency review record for a reviewer-target pair.
  //
  // Return Value
  // ------------
  // Promise<ReviewEmergency | null>    Emergency record or null
  //
  // Value Parameters
  // ----------------
  // reviewerUid    string    Firebase UID of reviewer
  // targetUid      string    Firebase UID of target
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
  private async getEmergencyRecord(reviewerUid: string, targetUid: string) {
    return this.emergencyRepo.findOne({
      where: {
        reviewer: { uid: reviewerUid },
        target: { uid: targetUid },
      },
    });
  }

  //********************************************************************
  //
  // createReview Method
  //
  // Creates a review with comprehensive validation. Handles normal,
  // emergency, and report review types with different validation rules.
  // Applies keyword moderation, weekly limits, and strike system.
  //
  // Return Value
  // ------------
  // Promise<Review>    Created review entity
  //
  // Value Parameters
  // ----------------
  // dto    CreateReviewDto    Review creation data
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // reviewerUid    string                Reviewer's Firebase UID
  // targetUid      string                Target's Firebase UID
  // rating         number                Review rating (1-10)
  // comment        string                Review comment text
  // type           string                Review type
  // reviewer       User|null             Reviewer user entity
  // target         User|null             Target user entity
  // isEmergency    boolean               Whether review is emergency type
  // isReport       boolean               Whether review is report type
  // existing       ReviewEmergency|null  Existing emergency record
  // window         ReviewWeekWindow|null Weekly window entity
  // active         ReviewWeekWindow      Active weekly window
  // strike         number                Strike number if issued
  // review         Review                Created review entity
  // existing       ReviewEmergency       Emergency record for finalization
  //
  //*******************************************************************
  async createReview(dto: CreateReviewDto) {
    const { reviewerUid, targetUid, rating, comment, type } = dto;

    if (reviewerUid === targetUid) {
      throw new BadRequestException("You cannot review yourself.");
    }

    await this.ensureUsersMatched(reviewerUid, targetUid);

    const reviewer = await this.users.getByUid(reviewerUid);
    const target = await this.users.getByUid(targetUid);

    if (!reviewer || !target) {
      throw new NotFoundException("User not found.");
    }

    if (await this.alreadyReviewed(reviewerUid, targetUid)) {
      throw new ForbiddenException("You already reviewed this user.");
    }

    const isEmergency = type === "emergency";
    const isReport = type === "report";

    if (isEmergency) {
      const existing = await this.getEmergencyRecord(reviewerUid, targetUid);

      if (existing?.used) {
        throw new ForbiddenException(
          "You already used your emergency review for this user.",
        );
      }

      // Check for SafetyIdentity instead of phone field (phone is no longer stored in User entity)
      // SafetyIdentity exists only if user has a phone number (hashed)
      if (!reviewer.safetyIdentityId) {
        throw new ForbiddenException(
          "Emergency reviews require a verified phone number.",
        );
      }
    }

    if (isReport) {
      const allowed = await this.hasReceivedOneMessage(reviewerUid, targetUid);
      if (!allowed) {
        throw new ForbiddenException(
          "You may only report after receiving at least ONE message.",
        );
      }
    }

    let window: ReviewWeekWindow | null = null;

    if (!isEmergency && !isReport) {
      const active = await this.getOrCreateWeekWindow(reviewerUid);

      if (active.reviewsUsed >= 3) {
        throw new ForbiddenException("You used all 3 reviews this week.");
      }

      if (active.reviewsUsed === 0 && (rating < 3 || rating > 10)) {
        throw new BadRequestException("First review must be between 3–10.");
      }

      if (active.reviewsUsed === 1 && (rating < 5 || rating > 10)) {
        throw new BadRequestException("Second review must be between 5–10.");
      }

      if (active.reviewsUsed === 2 && (rating < 3 || rating > 10)) {
        throw new BadRequestException("Third review must be between 3–10.");
      }

      window = active;
    }

    const flaggedByKeyword = this.containsFlaggedWord(comment);

    const review = this.reviewsRepo.create({
      reviewerUid,
      targetUid,
      rating,
      comment,
      type,
      reviewer,
      target,
      flaggedByKeywordScan: flaggedByKeyword,
      pendingHumanReview: flaggedByKeyword,
      approved: !flaggedByKeyword,
      reportCategory: dto.reportCategory || null,
      photos: dto.photos || [],
    });

    await this.reviewsRepo.save(review);

    if (window) {
      window.reviewsUsed += 1;
      await this.weekRepo.save(window);
    }

    if (isEmergency) {
      const existing =
        (await this.getEmergencyRecord(reviewerUid, targetUid)) ??
        this.emergencyRepo.create({ reviewer, target });

      existing.used = true;
      existing.usedAt = new Date();
      // Phone is no longer stored in User entity - phoneNumberSnapshot is deprecated
      // but kept for historical records. Set to null as phone is now only in SafetyIdentity (hashed).
      existing.phoneNumberSnapshot = null;

      await this.emergencyRepo.save(existing);

      // Update SafetyIdentity to mark emergency review as used (one per lifetime)
      if (reviewer.safetyIdentityId) {
        const safetyId: string = reviewer.safetyIdentityId;
        await this.users.markEmergencyReviewUsed(safetyId);
      }
    }

    return review;
  }

  //********************************************************************
  //
  // hasUsedEmergencyReview Method
  //
  // Checks if the user has used their emergency review (one per lifetime).
  // Checks SafetyIdentity.emergencyUsed flag.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if emergency review has been used
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID of user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // user            User|null        User entity
  // safetyIdentity  SafetyIdentity|null Safety identity if exists
  //
  //*******************************************************************
  async hasUsedEmergencyReview(uid: string): Promise<boolean> {
    const user = await this.users.getByUid(uid);
    if (!user || !user.safetyIdentityId) {
      return false;
    }

    const safetyId: string = user.safetyIdentityId;
    return await this.users.hasUsedEmergencyReview(safetyId);
  }

  //********************************************************************
  //
  // getUserReviews Method
  //
  // Gets all reviews written about a user, ordered by creation date
  // descending.
  //
  // Return Value
  // ------------
  // Promise<Review[]>    Array of review entities
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID of target user
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
  async getUserReviews(uid: string) {
    return this.reviewsRepo.find({
      where: {
        targetUid: uid,
        approved: true,
      },
      order: { createdAt: "DESC" },
    });
  }

  //********************************************************************
  //
  // getUserAverage Method
  //
  // Calculates a user's average rating from all reviews. Returns null
  // if no reviews exist. Rounded to 1 decimal place.
  //
  // Return Value
  // ------------
  // Promise<number | null>    Average rating or null
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID of target user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // reviews    Review[]    All reviews for the user
  // avg        number      Calculated average rating
  // sum        number      Sum of ratings
  // r          Review      Review in reduce loop
  //
  //*******************************************************************
  async getUserAverage(uid: string) {
    const reviews = await this.getUserReviews(uid);
    if (reviews.length === 0) return null;

    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

    return Number(avg.toFixed(1));
  }

  //********************************************************************
  //
  // getUserSummary Method
  //
  // Gets review summary (average rating and count) for a user. Returns
  // both average and count for display in rating gauge.
  //
  // Return Value
  // ------------
  // Promise<Object>    Object with average and count
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID of target user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // reviews    Review[]    All approved reviews for the user
  // avg        number      Calculated average rating
  //
  //*******************************************************************
  async getUserSummary(uid: string) {
    const reviews = await this.getUserReviews(uid);
    if (reviews.length === 0) {
      return { average: null, count: 0 };
    }

    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

    return {
      average: Number(avg.toFixed(1)),
      count: reviews.length,
    };
  }

  //********************************************************************
  //
  // getSentReviews Method
  //
  // Gets all reviews authored by a user, ordered by creation date
  // descending.
  //
  //*******************************************************************
  async getSentReviews(uid: string) {
    return this.reviewsRepo.find({
      where: { reviewerUid: uid },
      order: { createdAt: "DESC" },
    });
  }

  //********************************************************************
  //
  // getWeeklyUsage Method
  //
  // Gets weekly review usage for a user. Returns used count and
  // remaining count (out of 3 total).
  //
  // Return Value
  // ------------
  // Promise<Object>    Object with used and remaining counts
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
  // user    User|null              User entity
  // window  ReviewWeekWindow|null  Weekly window entity
  //
  //*******************************************************************
  async getWeeklyUsage(uid: string) {
    const user = await this.users.getByUid(uid);
    if (!user) throw new NotFoundException("User not found");

    const window = await this.weekRepo.findOne({
      where: { user: { id: user.id } },
    });

    if (!window) {
      return { used: 0, remaining: 3 };
    }

    return {
      used: window.reviewsUsed,
      remaining: 3 - window.reviewsUsed,
    };
  }
}
