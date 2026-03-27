//********************************************************************
//
// ReferralsService Class
//
// Service for managing the user referral program. Handles sending
// referral invitations by email, linking referred users when they
// create accounts, tracking in-app activity via pings, and granting
// token rewards once the referred user has been active for 60 minutes.
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
// referralsRepo    Repository<Referral>    TypeORM repository for referrals
// usersRepo        Repository<User>        TypeORM repository for users
// tokens           TokensService           Token service for granting rewards
// logger           Logger                  NestJS logger instance
//
//*******************************************************************

import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { Referral } from "../database/entities/referral.entity";
import { User } from "../database/entities/user.entity";
import { TokensService } from "../tokens/tokens.service";
import { EmailService } from "../email/email.service";
import { RedisService } from "../redis/redis.service";

const ACCEPTED_SCHOOL_DOMAINS = [
  "missouristate.edu",
  "drury.edu",
  "evangel.edu",
  "otc.edu",
  "mission.edu",
  "sbuniv.edu",
];

const MINUTES_REQUIRED_FOR_REWARD = 60;

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @InjectRepository(Referral)
    private readonly referralsRepo: Repository<Referral>,

    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,

    private readonly tokens: TokensService,
    private readonly emailService: EmailService,
    private readonly redis: RedisService,
  ) {}

  //********************************************************************
  //
  // isAcceptedSchoolDomain Function
  //
  // Checks whether an email address belongs to one of the accepted
  // school domains.
  //
  // Return Value
  // ------------
  // boolean    True if the domain is in the accepted list
  //
  // Value Parameters
  // ----------------
  // email    string    Email address to validate
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // domain    string    Extracted domain from the email
  //
  //*******************************************************************
  private isAcceptedSchoolDomain(email: string): boolean {
    const parts = email.toLowerCase().split("@");
    if (parts.length !== 2) return false;
    const domain = parts[1];
    return ACCEPTED_SCHOOL_DOMAINS.includes(domain);
  }

  //********************************************************************
  //
  // sendReferral Method
  //
  // Creates a referral record for the given email. Validates that the
  // email domain is an accepted school domain, that the email has not
  // already been referred, and that the referral is not circular
  // (the referred user cannot re-refer the person who referred them).
  //
  // Return Value
  // ------------
  // Promise<Referral>    Created referral entity
  //
  // Value Parameters
  // ----------------
  // referrerUserId    string    User ID of the person sending the referral
  // email             string    Email address to refer
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // normalizedEmail     string           Lowercase trimmed email
  // referrerUser        User|null        Referrer user entity
  // existing            Referral|null    Existing referral for this email
  // reverseReferral     Referral|null    Reverse referral check
  // referredUser        User|null        Referred user if already signed up
  // referral            Referral         Created referral entity
  //
  //*******************************************************************
  async sendReferral(referrerUserId: string, email: string): Promise<Referral> {
    const normalizedEmail = email.trim().toLowerCase();

    if (!this.isAcceptedSchoolDomain(normalizedEmail)) {
      throw new BadRequestException(
        "Referral email must be from an accepted school domain.",
      );
    }

    const referrerUser = await this.usersRepo.findOne({
      where: { id: referrerUserId },
    });

    if (!referrerUser) {
      throw new NotFoundException("Referrer user not found.");
    }

    // Check if this email has already been referred
    const existing = await this.referralsRepo.findOne({
      where: { referredEmail: normalizedEmail },
    });

    if (existing) {
      throw new ConflictException("This email has already been referred.");
    }

    // Check for circular referral: if the referred email belongs to an existing
    // user who already referred the current referrer, block it.
    const referredUser = await this.usersRepo.findOne({
      where: { email: normalizedEmail },
    });

    if (referredUser) {
      const reverseReferral = await this.referralsRepo.findOne({
        where: {
          referrerUserId: referredUser.id,
          referredUserId: referrerUserId,
        },
      });

      if (reverseReferral) {
        throw new BadRequestException(
          "Circular referrals are not allowed.",
        );
      }
    }

    const referral = this.referralsRepo.create({
      referrerUserId,
      referredEmail: normalizedEmail,
      referredUserId: referredUser ? referredUser.id : null,
      status: referredUser ? "signed_up" : "pending",
    });

    await this.referralsRepo.save(referral);

    const subject = "You’ve been invited to join Even";
    const htmlBody = [
      "<p>You’ve been invited to join Even.</p>",
      "<p>Create your account with this school email address to connect your referral automatically.</p>",
      "<p>Once you are verified and active in the app for 60 minutes, your friend earns 1 free search token and you earn 1 free message request token.</p>",
      "<p>See you on Even.</p>",
    ].join("");
    const textBody = [
      "You've been invited to join Even.",
      "",
      "Create your account with this school email address to connect your referral automatically.",
      "",
      "Once you are verified and active in the app for 60 minutes, your friend earns 1 free search token and you earn 1 free message request token.",
      "",
      "See you on Even.",
    ].join("\n");

    await this.emailService.sendEmail(
      normalizedEmail,
      subject,
      htmlBody,
      textBody,
    );

    this.logger.log(
      `Referral email sent to ${normalizedEmail} from user ${referrerUserId}`,
    );

    return referral;
  }

  //********************************************************************
  //
  // getMyReferrals Method
  //
  // Returns all referrals sent by the current user.
  //
  // Return Value
  // ------------
  // Promise<Referral[]>    Array of referral entities
  //
  // Value Parameters
  // ----------------
  // userId    string    User ID of the referrer
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
  async getMyReferrals(userId: string): Promise<Referral[]> {
    return this.referralsRepo.find({
      where: { referrerUserId: userId },
      order: { createdAt: "DESC" },
    });
  }

  //********************************************************************
  //
  // pingActivity Method
  //
  // Increments the minutesActive counter for a referred user by 1.
  // If the referred user has reached 60 minutes of activity and rewards
  // have not yet been granted, grants 1 search token to the referrer
  // and 1 message_request token to the referred user.
  //
  // Return Value
  // ------------
  // Promise<{ minutesActive: number; rewarded: boolean }>    Updated stats
  //
  // Value Parameters
  // ----------------
  // referredUserId    string    User ID of the referred (active) user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // referral            Referral|null    Referral entity for this user
  // rewardedNow         boolean          Whether rewards were granted in this call
  //
  //*******************************************************************
  async pingActivity(
    referredUserId: string,
  ): Promise<{ minutesActive: number; rewarded: boolean }> {
    const referral = await this.referralsRepo.findOne({
      where: { referredUserId },
    });

    if (!referral) {
      // User was not referred - no-op, return gracefully
      return { minutesActive: 0, rewarded: false };
    }

    referral.minutesActive += 1;

    let rewardedNow = false;

    if (
      referral.minutesActive >= MINUTES_REQUIRED_FOR_REWARD &&
      (!referral.referrerRewarded || !referral.referredRewarded)
    ) {
      // Grant search token to referrer
      if (!referral.referrerRewarded) {
        await this.tokens.grantAdminTokens(referral.referrerUserId, "search", 1);
        referral.referrerRewarded = true;
        this.logger.log(
          `Granted 1 search token to referrer ${referral.referrerUserId} for referral ${referral.id}`,
        );
      }

      // Grant message_request token to referred user
      if (!referral.referredRewarded) {
        await this.tokens.grantAdminTokens(referredUserId, "message_request", 1);
        referral.referredRewarded = true;
        this.logger.log(
          `Granted 1 message_request token to referred user ${referredUserId} for referral ${referral.id}`,
        );
      }

      referral.status = "rewarded";
      rewardedNow = true;
    } else if (
      referral.minutesActive >= MINUTES_REQUIRED_FOR_REWARD &&
      referral.status !== "rewarded"
    ) {
      referral.status = "qualified";
    }

    await this.referralsRepo.save(referral);

    return { minutesActive: referral.minutesActive, rewarded: rewardedNow };
  }

  //********************************************************************
  //
  // getReferralStatus Method
  //
  // Returns the referral status for the current user (were they referred?
  // have they qualified for rewards?).
  //
  // Return Value
  // ------------
  // Promise<Referral | null>    Referral entity or null if not referred
  //
  // Value Parameters
  // ----------------
  // userId    string    User ID of the current (referred) user
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
  async getReferralStatus(userId: string): Promise<Referral | null> {
    return this.referralsRepo.findOne({
      where: { referredUserId: userId },
    });
  }

  //********************************************************************
  //
  // sendReferralByUid Method
  //
  // Resolves the referrer user by their UID, then delegates to
  // sendReferral using their database ID.
  //
  // Return Value
  // ------------
  // Promise<Referral>    Created referral entity
  //
  // Value Parameters
  // ----------------
  // referrerUid    string    Firebase/Cognito UID of the referrer
  // email          string    Email address to refer
  //
  //*******************************************************************
  async sendReferralByUid(referrerUid: string, email: string): Promise<Referral> {
    const referrer = await this.usersRepo.findOne({ where: { uid: referrerUid } });
    if (!referrer) throw new NotFoundException("Referrer user not found.");
    return this.sendReferral(referrer.id, email);
  }

  //********************************************************************
  //
  // getMyReferralsByUid Method
  //
  // Resolves the user by UID and returns their sent referrals.
  //
  // Return Value
  // ------------
  // Promise<Referral[]>    Array of referral entities
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase/Cognito UID
  //
  //*******************************************************************
  async getMyReferralsByUid(uid: string): Promise<Referral[]> {
    const user = await this.usersRepo.findOne({ where: { uid } });
    if (!user) throw new NotFoundException("User not found.");
    return this.getMyReferrals(user.id);
  }

  //********************************************************************
  //
  // pingActivityByUid Method
  //
  // Resolves the user by UID and delegates to pingActivity.
  //
  // Return Value
  // ------------
  // Promise<{ minutesActive: number; rewarded: boolean }>
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase/Cognito UID
  //
  //*******************************************************************
  async pingActivityByUid(
    uid: string,
  ): Promise<{ minutesActive: number; rewarded: boolean }> {
    const user = await this.usersRepo.findOne({ where: { uid } });
    if (!user) throw new NotFoundException("User not found.");
    return this.pingActivity(user.id);
  }

  //********************************************************************
  //
  // getReferralStatusByUid Method
  //
  // Resolves the user by UID and returns their referral status.
  //
  // Return Value
  // ------------
  // Promise<Referral | null>
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase/Cognito UID
  //
  //*******************************************************************
  async getReferralStatusByUid(uid: string): Promise<Referral | null> {
    const user = await this.usersRepo.findOne({ where: { uid } });
    if (!user) return null;
    return this.getReferralStatus(user.id);
  }

  async recordAuthenticatedActivityByUid(uid: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { uid } });
    if (!user) return;

    const referral = await this.referralsRepo.findOne({
      where: { referredUserId: user.id },
    });
    if (!referral || referral.status === "rewarded") {
      return;
    }

    const minuteBucket = Math.floor(Date.now() / 60_000);
    const key = `referral:activity:${user.id}:${minuteBucket}`;
    const recorded = await this.redis.safe<string | null>(
      () =>
        this.redis.client.set(key, "1", {
          NX: true,
          EX: 120,
        }),
      { op: "setnx", key, ttlSeconds: 120 },
    );

    if (recorded !== "OK") {
      return;
    }

    await this.pingActivity(user.id);
  }

  //********************************************************************
  //
  // linkReferral Method
  //
  // Links a newly registered user to an existing pending referral by
  // their email address. Called from the auth/user creation flow when
  // a new account is created.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // email     string    Email of the newly registered user
  // userId    string    User ID of the newly registered user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // normalizedEmail    string           Lowercase trimmed email
  // referral           Referral|null    Existing referral for this email
  //
  //*******************************************************************
  async linkReferral(email: string, userId: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    const referral = await this.referralsRepo.findOne({
      where: { referredEmail: normalizedEmail, status: "pending" },
    });

    if (!referral) {
      return;
    }

    // Prevent circular referral on account creation
    const reverseReferral = await this.referralsRepo.findOne({
      where: {
        referrerUserId: userId,
        referredUserId: referral.referrerUserId,
      },
    });

    if (reverseReferral) {
      this.logger.log(
        `Skipping referral link for ${email} - would create circular referral`,
      );
      return;
    }

    referral.referredUserId = userId;
    referral.status = "signed_up";

    await this.referralsRepo.save(referral);

    this.logger.log(
      `Linked new user ${userId} (${email}) to referral ${referral.id}`,
    );
  }
}
