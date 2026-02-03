//********************************************************************
//
// ProfilesModule Class
//
// Module for profile management. Imports TypeORM entities (Profile,
// Like, Match, MessageRequest), UsersModule, S3Module, and RedisModule.
// Provides ProfilesService and ProfilesController.
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

import { ProfilesService } from "./profiles.service";

import { ProfilesController } from "./profiles.controller";

import { Profile } from "../database/entities/profile.entity";
import { Like } from "../database/entities/like.entity";
import { Match } from "../database/entities/match.entity";
import { Block } from "../database/entities/block.entity";

import { UsersModule } from "../users/users.module";
import { BlocksModule } from "../blocks/blocks.module";
import { S3Module } from "../s3/s3.module";
import { RedisModule } from "../redis/redis.module";
import { MessageRequest } from "../database/entities/message-request.entity";
import { ModerationModule } from "../moderation/moderation.module";
import { ProfilePhoto } from "../database/entities/profile-photo.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Profile,
      Like,
      Match,
      MessageRequest,
      Block,
      ProfilePhoto,
    ]),
    UsersModule,
    BlocksModule,
    S3Module,
    RedisModule,
    ModerationModule,
  ],

  providers: [ProfilesService],

  controllers: [ProfilesController],

  exports: [ProfilesService],
})
export class ProfilesModule {}
