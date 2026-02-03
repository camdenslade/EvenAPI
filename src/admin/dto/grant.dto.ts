//********************************************************************
//
// GrantDto Class
//
// Data Transfer Object for admin grant operations. Allows granting
// tokens and subscription status to users.
//
// Return Value
// ------------
// None (NestJS DTO class)
//
// Value Parameters
// ----------------
// userUid         string              Firebase UID of target user
// searchTokens    number|undefined    Number of search tokens to grant
// messageTokens   number|undefined    Number of message tokens to grant
// undoTokens      number|undefined    Number of undo tokens to grant
// isSubscribed    boolean|undefined    Subscription status to set
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
  IsBoolean,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
} from "class-validator";

export class GrantDto {
  @IsString()
  userUid: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  searchTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  messageTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  undoTokens?: number;

  @IsOptional()
  @IsBoolean()
  isSubscribed?: boolean;

  @IsOptional()
  @IsDateString()
  subscriptionExpiresAt?: string;
}
