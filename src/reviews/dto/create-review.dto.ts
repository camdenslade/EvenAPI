//********************************************************************
//
// CreateReviewDto Class
//
// Data Transfer Object for creating reviews. Represents the payload
// required to create a review. Validation rules enforce rating bounds
// (1-10), review type (normal, emergency, report), and comment integrity.
//
// Return Value
// ------------
// None (NestJS DTO class)
//
// Value Parameters
// ----------------
// reviewerUid          string                    Firebase UID of reviewer
// targetUid            string                    Firebase UID of target user
// rating               number                    Review rating (1-10)
// comment              string                    Review comment text
// type                 "normal"|"emergency"|"report" Review type
// phoneNumberSnapshot  string|null|undefined     Optional phone number snapshot
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

import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsArray,
} from "class-validator";

export class CreateReviewDto {
  @IsString()
  @IsNotEmpty()
  reviewerUid: string;

  @IsString()
  @IsNotEmpty()
  targetUid: string;

  @IsNumber()
  @Min(1)
  @Max(10)
  rating: number;

  @IsString()
  @IsNotEmpty()
  comment: string;

  @IsIn(["normal", "emergency", "report"])
  type: "normal" | "emergency" | "report";

  @IsOptional()
  @IsString()
  phoneNumberSnapshot?: string | null;

  @IsOptional()
  @IsString()
  reportCategory?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];
}
