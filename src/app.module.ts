//********************************************************************
//
// AppModule Class
//
// Root application module. Configures global settings including
// environment variables, database connections (TypeORM, Redis),
// cron jobs, and imports all feature modules. Applies CognitoAuthGuard
// globally to protect all routes.
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

import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { CognitoAuthGuard } from "./auth/guards/cognito-auth.guard";

import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { LikeModule } from "./like/like.module";
import { MatchesModule } from "./matches/matches.module";
import { ChatModule } from "./chat/chat.module";
import { SearchModule } from "./search/search.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { MessageRequestModule } from "./message-req/message-request.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PurchasesModule } from "./purchases/purchases.module";
import { BlocksModule } from "./blocks/blocks.module";
import { ReportsModule } from "./reports/reports.module";
import { ModerationModule } from "./moderation/moderation.module";
import { SupportModule } from "./support/support.module";
import { SuggestionsModule } from "./suggestions/suggestions.module";
import { AdminModule } from "./admin/admin.module";
import { ReferralsModule } from "./referrals/referrals.module";
import { CronModule } from "./cron/cron.module";

import { TypeOrmModule } from "@nestjs/typeorm";
import { getTypeOrmConfigSync } from "./database/typeorm.config";
import { SafetyIdentity } from "./database/entities/safety-identity.entity";

import { ConfigModule } from "@nestjs/config";
import { RedisModule } from "./redis/redis.module";
import { ScheduleModule } from "@nestjs/schedule";
import { RateLimitMiddleware } from "./middleware/rate-limit.middleware";
import { SecretsModule } from "./secrets/secrets.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    SecretsModule,

    RedisModule,

    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      useFactory: () => getTypeOrmConfigSync(),
    }),

    TypeOrmModule.forFeature([SafetyIdentity]),

    AuthModule,
    UsersModule,
    ProfilesModule,
    LikeModule,
    MatchesModule,
    ChatModule,
    SearchModule,
    ReviewsModule,
    MessageRequestModule,
    NotificationsModule,
    PurchasesModule,
    BlocksModule,
    ReportsModule,
    ModerationModule,
    SupportModule,
    SuggestionsModule,
    AdminModule,
    ReferralsModule,
    CronModule,
  ],

  providers: [
    {
      provide: APP_GUARD,
      useClass: CognitoAuthGuard,
    },
    RateLimitMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply rate limiting only to sensitive endpoints to keep Redis off hot paths
    consumer
      .apply(RateLimitMiddleware)
      .forRoutes(
        { path: "auth/(.*)", method: RequestMethod.ALL },
        { path: "purchases/(.*)", method: RequestMethod.ALL },
        { path: "reports/(.*)", method: RequestMethod.ALL },
        { path: "s3/(.*)", method: RequestMethod.ALL },
        { path: "uploads/(.*)", method: RequestMethod.ALL },
      );
  }
}
