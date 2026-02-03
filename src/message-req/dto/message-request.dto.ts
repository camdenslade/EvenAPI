//********************************************************************
//
// CreateMessageRequestDto Class
//
// Data Transfer Object for creating message requests. Used in POST
// /message-request endpoint.
//
// Return Value
// ------------
// None (NestJS DTO class)
//
// Value Parameters
// ----------------
// recipientUid    string              Firebase UID of recipient
// content         string              Message content text
// imageUrl        string|null|undefined Optional image URL
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

import { IsString, IsOptional, MaxLength, MinLength } from "class-validator";

export class CreateMessageRequestDto {
  @IsString()
  recipientUid!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content!: string;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;
}
