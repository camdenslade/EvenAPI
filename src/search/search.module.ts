//********************************************************************
//
// SearchModule Class
//
// Module for search functionality. Imports TypeORM entities (Profile,
// User, Like, Match, MessageRequest), LikeModule, MatchesModule,
// MessageRequestModule, and UsersModule. Provides SearchService and
// SearchController.
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

import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

import { Profile } from "../database/entities/profile.entity";
import { User } from "../database/entities/user.entity";
import { Like } from "../database/entities/like.entity";
import { Match } from "../database/entities/match.entity";
import { MessageRequest } from "../database/entities/message-request.entity";

import { LikeModule } from "../like/like.module";
import { MatchesModule } from "../matches/matches.module";
import { MessageRequestModule } from "../message-req/message-request.module";
import { UsersModule } from "../users/users.module";
import { TokensModule } from "../tokens/tokens.module";
import { BlocksModule } from "../blocks/blocks.module";
import { RedisModule } from "../redis/redis.module";
import { S3Module } from "../s3/s3.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Profile, User, Like, Match, MessageRequest]),
    LikeModule,
    MatchesModule,
    MessageRequestModule,
    UsersModule,
    TokensModule,
    BlocksModule,
    RedisModule,
    S3Module,
  ],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
