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
  Max,
} from "class-validator";

const MAX_ADMIN_GRANT = 10_000;

export class GrantDto {
  @IsString()
  userUid: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ADMIN_GRANT)
  searchTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ADMIN_GRANT)
  messageTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ADMIN_GRANT)
  undoTokens?: number;

  @IsOptional()
  @IsBoolean()
  isSubscribed?: boolean;

  @IsOptional()
  @IsDateString()
  subscriptionExpiresAt?: string;
}
