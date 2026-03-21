//********************************************************************
//
// UsersModule Class
//
// Module for user identity lifecycle management. Encapsulates user
// creation, location updates, review timeout enforcement, and full
// account deletion with safety identity persistence. Exports UsersService
// for use by ProfilesModule, MatchesModule, ReviewsModule, messaging
// system, and swipe/queue system.
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

import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";

import { User } from "../database/entities/user.entity";
import { Profile } from "../database/entities/profile.entity";
import { Like } from "../database/entities/like.entity";
import { Match } from "../database/entities/match.entity";
import { Thread } from "../database/entities/thread.entity";
import { Message } from "../database/entities/message.entity";
import { Review } from "../database/entities/review.entity";
import { ReviewStrike } from "../database/entities/review-strike.entity";
import { ReviewWeekWindow } from "../database/entities/review-week-window.entity";
import { ReviewEmergency } from "../database/entities/review-emergency.entity";
import { SafetyIdentity } from "../database/entities/safety-identity.entity";
import { Purchase } from "../database/entities/purchase.entity";
import { AuditEvent } from "../database/entities/audit-event.entity";
import { VerifiedSchoolEmail } from "../database/entities/verified-school-email.entity";
import { RedisModule } from "../redis/redis.module";

import { S3Module } from "../s3/s3.module";
import { TokensModule } from "../tokens/tokens.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Profile,
      Like,
      Match,
      Thread,
      Message,
      Review,
      ReviewStrike,
      ReviewWeekWindow,
      ReviewEmergency,
      SafetyIdentity,
      Purchase,
      AuditEvent,
      VerifiedSchoolEmail,
    ]),

    S3Module,
    TokensModule,
    RedisModule,
    NotificationsModule,
  ],

  controllers: [UsersController],

  providers: [UsersService],

  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
