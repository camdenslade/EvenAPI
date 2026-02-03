//********************************************************************
//
// ReportsModule Class
//
// Module for report management. Provides ReportsController and ReportsService
// for handling user and content reports.
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

import { Report } from "../database/entities/report.entity";

import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [TypeOrmModule.forFeature([Report])],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
