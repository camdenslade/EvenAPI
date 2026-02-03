//********************************************************************
//
// LikeDto Class
//
// Data Transfer Object for like actions. Used in POST /like endpoint.
//
// Return Value
// ------------
// None (NestJS DTO class)
//
// Value Parameters
// ----------------
// targetUid    string    Firebase UID of the user being liked
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

import { IsString } from "class-validator";

export class LikeDto {
  @IsString()
  targetUid!: string;
}
