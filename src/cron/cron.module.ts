//********************************************************************
//
// CronModule Class
//
// Module for scheduled background jobs. Imports TypeORM entities
// (Match, Like). Provides CronJobsService for hourly maintenance
// tasks.
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

import { CronJobsService } from "./cron.service";

import { Match } from "../database/entities/match.entity";
import { Like } from "../database/entities/like.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Match, Like])],
  providers: [CronJobsService],
})
export class CronModule {}
