//********************************************************************
//
// MatchesModule Class
//
// Module for match management. Imports TypeORM entities (Match, Thread,
// Profile), UsersModule, ProfilesModule, and RedisModule. Provides
// MatchesService and MatchesController.
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

import { Match } from "../database/entities/match.entity";
import { Thread } from "../database/entities/thread.entity";
import { Profile } from "../database/entities/profile.entity";

import { MatchesService } from "./matches.service";

import { MatchesController } from "./matches.controller";

import { UsersModule } from "../users/users.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { RedisModule } from "../redis/redis.module";
import { BlocksModule } from "../blocks/blocks.module";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Match, Thread, Profile]),
    UsersModule,
    ProfilesModule,
    RedisModule,
    BlocksModule,
    forwardRef(() => ChatModule),
  ],

  providers: [MatchesService],

  controllers: [MatchesController],

  exports: [MatchesService],
})
export class MatchesModule {}
