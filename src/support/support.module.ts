//********************************************************************
//
// SupportModule
//
// Handles public support ticket submissions.
//
//********************************************************************

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SupportTicket } from "./entities/support-ticket.entity";
import { SupportService } from "./support.service";
import { SupportController } from "./support.controller";
import { SupportRateLimitGuard } from "../common/guards/rate-limit.guard";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [TypeOrmModule.forFeature([SupportTicket]), RedisModule],
  controllers: [SupportController],
  providers: [SupportService, SupportRateLimitGuard],
})
export class SupportModule {}
