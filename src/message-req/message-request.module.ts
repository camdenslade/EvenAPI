//********************************************************************
//
// MessageRequestModule Class
//
// Module for message request functionality. Imports TypeORM entities
// (MessageRequest, Thread, Message, Like, Match), UsersModule,
// ProfilesModule, LikeModule, MatchesModule, and RedisModule. Provides
// MessageRequestService and MessageRequestController.
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

import { MessageRequest } from "../database/entities/message-request.entity";
import { Thread } from "../database/entities/thread.entity";
import { Message } from "../database/entities/message.entity";
import { Like } from "src/database/entities/like.entity";
import { Profile } from "../database/entities/profile.entity";
import { User } from "../database/entities/user.entity";

import { MessageRequestService } from "./message-request.service";
import { MessageRequestController } from "./message-request.controller";

import { UsersModule } from "../users/users.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { LikeModule } from "../like/like.module";
import { MatchesModule } from "../matches/matches.module";
import { RedisModule } from "../redis/redis.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TokensModule } from "../tokens/tokens.module";
import { BlocksModule } from "../blocks/blocks.module";
import { Match } from "../database/entities/match.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MessageRequest,
      Thread,
      Message,
      Like,
      Match,
      Profile,
      User,
    ]),
    UsersModule,
    ProfilesModule,
    LikeModule,
    MatchesModule,
    RedisModule,
    NotificationsModule,
    TokensModule,
    BlocksModule,
  ],
  providers: [MessageRequestService],
  controllers: [MessageRequestController],
  exports: [MessageRequestService],
})
export class MessageRequestModule {}
