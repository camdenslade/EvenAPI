//********************************************************************
//
// RedisModule Class
//
// Module for Redis operations. Provides RedisService and exports it for
// use by other modules (ProfilesModule, LikeModule, MatchesModule, etc.).
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

import { RedisService } from "./redis.service";
import { SecretsModule } from "../secrets/secrets.module";

@Module({
  imports: [SecretsModule],
  providers: [RedisService],

  exports: [RedisService],
})
export class RedisModule {}
