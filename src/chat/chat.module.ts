//********************************************************************
//
// ChatModule Class
//
// Module for chat functionality. Imports TypeORM entities (Thread, Message,
// Match, Profile), MatchesModule, and UsersModule. Provides ChatService,
// ChatGateway, and ChatController.
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

import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { Thread } from "../database/entities/thread.entity";
import { Message } from "../database/entities/message.entity";
import { Match } from "../database/entities/match.entity";
import { Profile } from "../database/entities/profile.entity";
import { User } from "../database/entities/user.entity";

import { ChatService } from "./chat.service";

import { ChatController } from "./chat.controller";

import { ChatGateway } from "./chat.gateway";
import { MatchesModule } from "../matches/matches.module";
import { UsersModule } from "../users/users.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { BlocksModule } from "../blocks/blocks.module";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Thread, Message, Match, Profile, User]),
    forwardRef(() => MatchesModule),
    UsersModule,
    NotificationsModule,
    ProfilesModule,
    BlocksModule,
    RedisModule,
  ],

  providers: [ChatService, ChatGateway],

  controllers: [ChatController],

  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
