//********************************************************************
//
// EmailModule Class
//
// Module for email verification functionality. Provides EmailService
// for sending and verifying email codes via Postmark.
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
import { EmailService } from "./email.service";
import { EmailVerification } from "../database/entities/email-verification.entity";

@Module({
  imports: [TypeOrmModule.forFeature([EmailVerification])],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
