//********************************************************************
//
// AuthModule Class
//
// Authentication module for Cognito-backed auth. Provides auth
// controller and shared dependencies.
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

import { AuthController } from "./auth.controller";
import { EmailModule } from "../email/email.module";
import { UsersModule } from "../users/users.module";
import { TokensModule } from "../tokens/tokens.module";
import { RedisModule } from "../redis/redis.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { MatchesModule } from "../matches/matches.module";
import { BlocksModule } from "../blocks/blocks.module";

@Module({
  imports: [
    EmailModule,
    UsersModule,
    TokensModule,
    RedisModule,
    ProfilesModule,
    MatchesModule,
    BlocksModule,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
