//********************************************************************
//
// ReviewsController Class
//
// Controller for review endpoints. Handles POST /reviews to create
// reviews, GET /reviews/user/:uid to get user reviews, GET /reviews/me
// to get authenticated user's reviews, and GET /reviews/summary/me for
// review summary data.
//
// Return Value
// ------------
// None (NestJS controller class)
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
// reviewsService    ReviewsService    Injected reviews service
//
//*******************************************************************

import { Controller, Post, Get, Body, Param, Req } from "@nestjs/common";

import { ReviewsService } from "./reviews.service";
import { ReviewAppealsService } from "./review-appeals.service";

import { CreateReviewDto } from "./dto/create-review.dto";
import { ReviewResponseDto } from "./dto/review-response.dto";
import { ReviewWeekUsageDto } from "./dto/review-week-usage.dto";
import { AuthUser } from "../auth/auth-user.decorator";

interface FirebaseRequest {
  user: { uid: string };
}

interface SubmitAppealDto {
  text?: string;
  photoUrls?: string[];
}

@Controller("reviews")
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly reviewAppealsService: ReviewAppealsService,
  ) {}

  //********************************************************************
  //
  // createReview Method
  //
  // POST /reviews endpoint. Creates a review from the authenticated
  // user. Wraps response in ReviewResponseDto.
  //
  // Return Value
  // ------------
  // Promise<ReviewResponseDto>    Review response DTO
  //
  // Value Parameters
  // ----------------
  // req    FirebaseRequest        Request object with authenticated user
  //   user    Object                  Authenticated user
  //     uid     string                    Firebase UID
  // dto    CreateReviewDto        Review creation data
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // reviewerUid    string        Reviewer's Firebase UID
  // review         Review        Created review entity
  //
  //*******************************************************************
  @Post()
  async createReview(
    @Req() req: FirebaseRequest,
    @Body() dto: CreateReviewDto,
  ) {
    const reviewerUid = req.user.uid;

    const review = await this.reviewsService.createReview({
      ...dto,
      reviewerUid,
    });

    return new ReviewResponseDto(review);
  }

  //********************************************************************
  //
  // getUserReviews Method
  //
  // GET /reviews/user/:uid endpoint. Returns all reviews written about
  // a given user.
  //
  // Return Value
  // ------------
  // Promise<ReviewResponseDto[]>    Array of review response DTOs
  //
  // Value Parameters
  // ----------------
  // uid    string    Target user's Firebase UID from route parameter
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // reviews    Review[]    Review entities
  // r          Review      Review in map loop
  //
  //*******************************************************************
  @Get("user/:uid")
  async getUserReviews(@Param("uid") uid: string) {
    const reviews = await this.reviewsService.getUserReviews(uid);
    return reviews.map((r) => new ReviewResponseDto(r));
  }

  //********************************************************************
  //
  // getUserAverage Method
  //
  // GET /reviews/user/:uid/average endpoint. Returns a user's average
  // rating (1 decimal place).
  //
  // Return Value
  // ------------
  // Promise<number | null>    Average rating or null
  //
  // Value Parameters
  // ----------------
  // uid    string    Target user's Firebase UID from route parameter
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
  @Get("user/:uid/average")
  async getUserAverage(@Param("uid") uid: string) {
    return this.reviewsService.getUserAverage(uid);
  }

  //********************************************************************
  //
  // getUserSummary Method
  //
  // GET /reviews/user/:uid/summary endpoint. Returns review summary
  // (average rating and count) for a given user.
  //
  // Return Value
  // ------------
  // Promise<Object>    Object with average and count
  //
  // Value Parameters
  // ----------------
  // uid    string    Target user's Firebase UID from route parameter
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
  @Get("user/:uid/summary")
  async getUserSummary(@Param("uid") uid: string) {
    return this.reviewsService.getUserSummary(uid);
  }

  //********************************************************************
  //
  // getMyReviews Method
  //
  // GET /reviews/me endpoint. Returns all reviews the logged-in user
  // has received.
  //
  // Return Value
  // ------------
  // Promise<ReviewResponseDto[]>    Array of review response DTOs
  //
  // Value Parameters
  // ----------------
  // req    FirebaseRequest    Request object with authenticated user
  //   user    Object              Authenticated user
  //     uid     string                Firebase UID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // uid       string        User's Firebase UID
  // reviews   Review[]      Review entities
  // r         Review        Review in map loop
  //
  //*******************************************************************
  @Get("me")
  async getMyReviews(@Req() req: FirebaseRequest) {
    const uid = req.user.uid;
    const reviews = await this.reviewsService.getUserReviews(uid);
    return reviews.map((r) => new ReviewResponseDto(r));
  }

  //********************************************************************
  //
  // getSentReviews Method
  //
  // GET /reviews/sent/:uid endpoint. Returns all reviews authored by a
  // given user (sent reviews).
  //
  //*******************************************************************
  @Get("sent/:uid")
  async getSentReviews(@Param("uid") uid: string) {
    const reviews = await this.reviewsService.getSentReviews(uid);
    return reviews.map((r) => new ReviewResponseDto(r));
  }

  //********************************************************************
  //
  // getMySummary Method
  //
  // GET /reviews/summary/me endpoint. Returns average rating, total
  // count of reviews, and weekly usage (used / remaining).
  //
  // Return Value
  // ------------
  // Promise<Object>    Summary object with average, count, and week usage
  //
  // Value Parameters
  // ----------------
  // req    FirebaseRequest    Request object with authenticated user
  //   user    Object              Authenticated user
  //     uid     string                Firebase UID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // uid         string                User's Firebase UID
  // average     number|null           Average rating
  // weekly      Object                Weekly usage object
  // allReviews  Review[]              All reviews for the user
  //
  //*******************************************************************
  @Get("summary/me")
  async getMySummary(@Req() req: FirebaseRequest) {
    const uid = req.user.uid;

    const average = await this.reviewsService.getUserAverage(uid);
    const weekly = await this.reviewsService.getWeeklyUsage(uid);
    const allReviews = await this.reviewsService.getUserReviews(uid);

    return {
      average,
      count: allReviews.length,
      week: new ReviewWeekUsageDto(weekly.used, weekly.remaining),
    };
  }

  //********************************************************************
  //
  // getWeeklyUsage Method
  //
  // GET /reviews/me/week-usage endpoint. Returns how many reviews the
  // current user used this week, and how many remain out of the weekly
  // limit.
  //
  // Return Value
  // ------------
  // Promise<ReviewWeekUsageDto>    Weekly usage DTO
  //
  // Value Parameters
  // ----------------
  // req    FirebaseRequest    Request object with authenticated user
  //   user    Object              Authenticated user
  //     uid     string                Firebase UID
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // result    Object    Weekly usage result from service
  //
  //*******************************************************************
  @Get("me/week-usage")
  async getWeeklyUsage(@Req() req: FirebaseRequest) {
    const result = await this.reviewsService.getWeeklyUsage(req.user.uid);
    return new ReviewWeekUsageDto(result.used, result.remaining);
  }

  //********************************************************************
  //
  // hasUsedEmergencyReview Method
  //
  // GET /reviews/me/emergency-used endpoint. Returns whether the
  // authenticated user has used their emergency review (one per lifetime).
  //
  // Return Value
  // ------------
  // Promise<{ used: boolean }>    Object indicating if emergency review was used
  //
  // Value Parameters
  // ----------------
  // req    FirebaseRequest    Request object with authenticated user
  //
  //*******************************************************************
  @Get("me/emergency-used")
  async hasUsedEmergencyReview(@Req() req: FirebaseRequest) {
    const used = await this.reviewsService.hasUsedEmergencyReview(req.user.uid);
    return { used };
  }

  //********************************************************************
  //
  // submitAppeal Method
  //
  // POST /reviews/:reviewId/appeal endpoint. Submits an appeal for a
  // review. The authenticated user must be the subject of the review
  // (targetUid). Only one appeal per review is allowed.
  //
  // Return Value
  // ------------
  // Promise<ReviewAppeal>    Created appeal entity
  //
  // Value Parameters
  // ----------------
  // reviewId    string             Review ID from route parameter
  // user        AuthUser           Authenticated user
  // dto         SubmitAppealDto    Optional text and photo URLs
  //
  //*******************************************************************
  @Post(":reviewId/appeal")
  async submitAppeal(
    @Param("reviewId") reviewId: string,
    @AuthUser() user: { uid: string },
    @Body() dto: SubmitAppealDto,
  ) {
    return this.reviewAppealsService.submitAppeal(reviewId, user.uid, dto);
  }

  //********************************************************************
  //
  // getMyAppeals Method
  //
  // GET /reviews/my-appeals endpoint. Returns all appeals submitted
  // by the currently authenticated user.
  //
  // Return Value
  // ------------
  // Promise<ReviewAppeal[]>    Array of appeal entities
  //
  // Value Parameters
  // ----------------
  // user    AuthUser    Authenticated user
  //
  //*******************************************************************
  @Get("my-appeals")
  async getMyAppeals(@AuthUser() user: { uid: string }) {
    return this.reviewAppealsService.getMyAppeals(user.uid);
  }
}
