//********************************************************************
//
// ReferralsModule Class
//
// Module for the user referral program. Registers the Referral entity,
// provides ReferralsService and ReferralsController, and imports
// TokensModule to grant rewards to both parties when the referred user
// has been active for 60 minutes.
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

import { Referral } from "../database/entities/referral.entity";
import { User } from "../database/entities/user.entity";

import { TokensModule } from "../tokens/tokens.module";

import { ReferralsService } from "./referrals.service";
import { ReferralsController } from "./referrals.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([Referral, User]),
    TokensModule,
  ],

  controllers: [ReferralsController],

  providers: [ReferralsService],

  exports: [ReferralsService],
})
export class ReferralsModule {}
