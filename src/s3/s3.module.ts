//********************************************************************
//
// S3Module Class
//
// Module for AWS S3 operations. Provides S3Service and exports it for
// use by other modules (ProfilesModule, UsersModule).
//
// Return Value
// ------------
// None (NestJS module class)
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

import { Module } from "@nestjs/common";

import { S3Service } from "./s3.service";

@Module({
  providers: [S3Service],

  exports: [S3Service],
})
export class S3Module {}
