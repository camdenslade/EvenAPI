//********************************************************************
//
// ReviewsModule Class
//
// Module for review functionality. Imports TypeORM entities (Review,
// ReviewStrike, ReviewWeekWindow, ReviewEmergency, User), UsersModule,
// and ChatModule. Provides ReviewsService and ReviewsController.
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

import { Review } from "../database/entities/review.entity";
import { ReviewStrike } from "../database/entities/review-strike.entity";
import { ReviewWeekWindow } from "../database/entities/review-week-window.entity";
import { ReviewEmergency } from "../database/entities/review-emergency.entity";
import { User } from "../database/entities/user.entity";

import { UsersModule } from "../users/users.module";
import { ChatModule } from "../chat/chat.module";

import { ReviewsService } from "./reviews.service";

import { ReviewsController } from "./reviews.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Review,
      ReviewStrike,
      ReviewWeekWindow,
      ReviewEmergency,
      User,
    ]),
    UsersModule,
    ChatModule,
  ],

  controllers: [ReviewsController],

  providers: [ReviewsService],

  exports: [ReviewsService],
})
export class ReviewsModule {}
