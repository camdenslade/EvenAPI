//********************************************************************
//
// ReviewAppealsService Class
//
// Service for managing review appeals. Allows users who are the subject
// of a review (targetUid) to submit an appeal with an optional written
// explanation and supporting photos. Admins can resolve appeals by
// approving or rejecting them. Approval causes the original review to
// be marked as rejected.
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
// appealsRepo    Repository<ReviewAppeal>    TypeORM repository for review appeals
// reviewsRepo    Repository<Review>          TypeORM repository for reviews
// usersRepo      Repository<User>            TypeORM repository for users
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

import { ReviewAppeal } from "../database/entities/review-appeal.entity";
import { Review } from "../database/entities/review.entity";
import { User } from "../database/entities/user.entity";

interface SubmitAppealDto {
  text?: string;
  photoUrls?: string[];
}

interface ResolveAppealDto {
  status: "approved" | "rejected";
  adminNote?: string;
}

@Injectable()
export class ReviewAppealsService {
  constructor(
    @InjectRepository(ReviewAppeal)
    private readonly appealsRepo: Repository<ReviewAppeal>,

    @InjectRepository(Review)
    private readonly reviewsRepo: Repository<Review>,

    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  //********************************************************************
  //
  // submitAppeal Method
  //
  // Creates an appeal for a review. The authenticated user must be the
  // target of the review (targetUid). Only one appeal per review is
  // permitted.
  //
  // Return Value
  // ------------
  // Promise<ReviewAppeal>    Created appeal entity
  //
  // Value Parameters
  // ----------------
  // reviewId      string            Review ID being appealed
  // appellantUid  string            Firebase/Cognito UID of the appellant
  // dto           SubmitAppealDto   Optional text and photo URLs
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // review            Review|null        Review entity
  // appellant         User|null          Appellant user entity
  // existingAppeal    ReviewAppeal|null  Existing appeal for this review
  // appeal            ReviewAppeal       Created appeal entity
  //
  //*******************************************************************
  async submitAppeal(
    reviewId: string,
    appellantUid: string,
    dto: SubmitAppealDto,
  ): Promise<ReviewAppeal> {
    const review = await this.reviewsRepo.findOne({ where: { id: reviewId } });

    if (!review) {
      throw new NotFoundException("Review not found.");
    }

    const appellant = await this.usersRepo.findOne({
      where: { uid: appellantUid },
    });

    if (!appellant) {
      throw new NotFoundException("User not found.");
    }

    if (review.targetUid !== appellantUid) {
      throw new ForbiddenException(
        "Only the subject of a review may submit an appeal.",
      );
    }

    const existingAppeal = await this.appealsRepo.findOne({
      where: { reviewId },
    });

    if (existingAppeal) {
      throw new BadRequestException(
        "An appeal for this review has already been submitted.",
      );
    }

    const appeal = this.appealsRepo.create({
      reviewId,
      appellantUserId: appellant.id,
      text: dto.text ?? null,
      photoUrls: dto.photoUrls ?? [],
      status: "pending",
      adminNote: null,
    });

    return this.appealsRepo.save(appeal);
  }

  //********************************************************************
  //
  // getMyAppeals Method
  //
  // Returns all appeals submitted by the current user.
  //
  // Return Value
  // ------------
  // Promise<ReviewAppeal[]>    Array of appeal entities
  //
  // Value Parameters
  // ----------------
  // appellantUid    string    Firebase/Cognito UID of the user
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // appellant    User|null    Appellant user entity
  //
  //*******************************************************************
  async getMyAppeals(appellantUid: string): Promise<ReviewAppeal[]> {
    const appellant = await this.usersRepo.findOne({
      where: { uid: appellantUid },
    });

    if (!appellant) {
      throw new NotFoundException("User not found.");
    }

    return this.appealsRepo.find({
      where: { appellantUserId: appellant.id },
      order: { createdAt: "DESC" },
    });
  }

  //********************************************************************
  //
  // getPendingAppeals Method
  //
  // Returns all pending appeals for admin review.
  //
  // Return Value
  // ------------
  // Promise<ReviewAppeal[]>    Array of pending appeal entities
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
  // None
  //
  //*******************************************************************
  async getPendingAppeals(): Promise<ReviewAppeal[]> {
    return this.appealsRepo.find({
      where: { status: "pending" },
      order: { createdAt: "ASC" },
    });
  }

  //********************************************************************
  //
  // resolveAppeal Method
  //
  // Resolves an appeal by approving or rejecting it. If approved, the
  // associated review is marked as rejected (review.rejected = true).
  //
  // Return Value
  // ------------
  // Promise<ReviewAppeal>    Updated appeal entity
  //
  // Value Parameters
  // ----------------
  // appealId    string             ID of the appeal to resolve
  // dto         ResolveAppealDto   Resolution status and optional admin note
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // appeal    ReviewAppeal|null    Appeal entity
  // review    Review|null          Associated review entity
  //
  //*******************************************************************
  async resolveAppeal(
    appealId: string,
    dto: ResolveAppealDto,
  ): Promise<ReviewAppeal> {
    const appeal = await this.appealsRepo.findOne({
      where: { id: appealId },
    });

    if (!appeal) {
      throw new NotFoundException("Appeal not found.");
    }

    if (appeal.status !== "pending") {
      throw new BadRequestException("Appeal has already been resolved.");
    }

    appeal.status = dto.status;
    appeal.adminNote = dto.adminNote ?? null;

    await this.appealsRepo.save(appeal);

    if (dto.status === "approved") {
      const review = await this.reviewsRepo.findOne({
        where: { id: appeal.reviewId },
      });

      if (review) {
        review.rejected = true;
        review.approved = false;
        await this.reviewsRepo.save(review);
      }
    }

    return appeal;
  }
}
