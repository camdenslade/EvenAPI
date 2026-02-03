//********************************************************************
//
// AdminModule Class
//
// Module for admin functionality. Provides AdminController and
// AdminService.
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

import { User } from "../database/entities/user.entity";
import { ProfilePhoto } from "../database/entities/profile-photo.entity";
import { Report } from "../database/entities/report.entity";
import { Review } from "../database/entities/review.entity";
import { ReviewStrike } from "../database/entities/review-strike.entity";
import { Match } from "../database/entities/match.entity";
import { Thread } from "../database/entities/thread.entity";
import { Message } from "../database/entities/message.entity";
import { Profile } from "../database/entities/profile.entity";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { UsersModule } from "../users/users.module";
import { SearchModule } from "../search/search.module";
import { AuditEvent } from "../database/entities/audit-event.entity";
import { TokensModule } from "../tokens/tokens.module";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";
import { ModerationModule } from "../moderation/moderation.module";
import { RedisModule } from "../redis/redis.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { Admin } from "../database/entities/admin.entity";
import { AdminGuard } from "../auth/guards/admin.guard";
import { AdminAuthController } from "./admin-auth.controller";
import { S3Module } from "../s3/s3.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { EmailModule } from "../email/email.module";
import { SupportTicket } from "../support/entities/support-ticket.entity";
import { Suggestion } from "../suggestions/entities/suggestion.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Admin,
      User,
      Profile,
      ProfilePhoto,
      AuditEvent,
      Report,
      Review,
      ReviewStrike,
      Match,
      Thread,
      Message,
      SupportTicket,
      Suggestion,
    ]),
    UsersModule,
    SearchModule,
    TokensModule,
    ModerationModule,
    RedisModule,
    ProfilesModule,
    NotificationsModule,
    S3Module,
    ReviewsModule,
    EmailModule,
  ],
  controllers: [AdminController, AdminAuthController],
  providers: [AdminService, AdminAuditInterceptor, AdminGuard],
  exports: [AdminGuard],
})
export class AdminModule {}
