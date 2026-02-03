//********************************************************************
//
// ReviewResponseDto Class
//
// Standard API response wrapper for a Review entity. Ensures the
// frontend only receives whitelisted properties. Used to transform
// Review entities into safe response objects.
//
// Return Value
// ------------
// None (NestJS DTO class)
//
// Value Parameters
// ----------------
// id           string                    Review ID
// reviewerUid  string                    Firebase UID of reviewer
// targetUid    string                    Firebase UID of target user
// rating       number                    Review rating (1-10)
// comment      string                    Review comment text
// type         "normal"|"emergency"|"report" Review type
// createdAt    Date                      Review creation timestamp
//
// Reference Parameters
// --------------------
// review    Review    Review entity to transform
//
// Local Variables
// ---------------
// None
//
//*******************************************************************

import { Review } from "../../database/entities/review.entity";

export class ReviewResponseDto {
  id: string;
  reviewerUid: string;
  targetUid: string;
  rating: number;
  comment: string;
  type: "normal" | "emergency" | "report";
  createdAt: Date;

  constructor(review: Review) {
    this.id = review.id;
    this.reviewerUid = review.reviewerUid;
    this.targetUid = review.targetUid;
    this.rating = review.rating;
    this.comment = review.comment;
    this.type = review.type;
    this.createdAt = review.createdAt;
  }
}
