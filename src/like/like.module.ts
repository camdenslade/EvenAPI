//********************************************************************
//
// LikeModule Class
//
// Module for like/swipe functionality. Imports TypeORM entities (Like,
// MessageRequest, Match), UsersModule, ProfilesModule, MatchesModule,
// and RedisModule. Provides LikeService and LikeController.
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
import { TypeOrmModule } from "@nestjs/typeorm";

import { Like } from "../database/entities/like.entity";
import { User } from "../database/entities/user.entity";
import { LikeService } from "./like.service";
import { LikeController } from "./like.controller";

import { UsersModule } from "../users/users.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { MatchesModule } from "../matches/matches.module";
import { MessageRequest } from "src/database/entities/message-request.entity";
import { Match } from "src/database/entities/match.entity";
import { RedisModule } from "../redis/redis.module";
import { TokensModule } from "../tokens/tokens.module";
import { BlocksModule } from "../blocks/blocks.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Like, MessageRequest, Match, User]),
    UsersModule,
    ProfilesModule,
    MatchesModule,
    RedisModule,
    TokensModule,
    BlocksModule,
  ],
  controllers: [LikeController],
  providers: [LikeService],
  exports: [LikeService],
})
export class LikeModule {}
