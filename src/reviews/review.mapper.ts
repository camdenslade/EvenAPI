//********************************************************************
//
// ReviewMapper Class
//
// Utility class for converting Review entities into DTOs used by the
// API layer. Provides static methods to map single reviews or arrays
// of reviews to ReviewResponseDto objects.
//
// Return Value
// ------------
// None (Utility class with static methods)
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

import { Review } from "../database/entities/review.entity";

import { ReviewResponseDto } from "./dto/review-response.dto";

export class ReviewMapper {
  //********************************************************************
  //
  // toResponse Static Method
  //
  // Maps a single Review entity to a ReviewResponseDto.
  //
  // Return Value
  // ------------
  // ReviewResponseDto    Review response DTO
  //
  // Value Parameters
  // ----------------
  // review    Review    Review entity to map
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
  static toResponse(review: Review): ReviewResponseDto {
    return new ReviewResponseDto(review);
  }

  //********************************************************************
  //
  // toResponses Static Method
  //
  // Maps an array of Review entities to an array of ReviewResponseDto.
  //
  // Return Value
  // ------------
  // ReviewResponseDto[]    Array of review response DTOs
  //
  // Value Parameters
  // ----------------
  // reviews    Review[]    Array of review entities to map
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // r    Review    Review in map loop
  //
  //*******************************************************************
  static toResponses(reviews: Review[]): ReviewResponseDto[] {
    return reviews.map((r) => new ReviewResponseDto(r));
  }
}
