//********************************************************************
//
// NotificationsModule Class
//
// Module for push notification functionality. Imports TypeORM entities
// (User), HttpModule for HTTP requests, and provides NotificationsService.
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
import { HttpModule } from "@nestjs/axios";

import { NotificationsService } from "./notifications.service";
import { User } from "../database/entities/user.entity";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [TypeOrmModule.forFeature([User]), HttpModule, RedisModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
