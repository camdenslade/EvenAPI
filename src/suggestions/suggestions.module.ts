//********************************************************************
//
// SuggestionsModule
//
// Handles public suggestion submissions.
//
//********************************************************************

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Suggestion } from "./entities/suggestion.entity";
import { SuggestionsService } from "./suggestions.service";
import { SuggestionsController } from "./suggestions.controller";
import { SuggestionsRateLimitGuard } from "../common/guards/rate-limit.guard";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [TypeOrmModule.forFeature([Suggestion]), RedisModule],
  controllers: [SuggestionsController],
  providers: [SuggestionsService, SuggestionsRateLimitGuard],
})
export class SuggestionsModule {}
