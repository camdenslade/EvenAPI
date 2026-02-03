//********************************************************************
//
// PurchasesModule Class
//
// Module for in-app purchase management. Imports TypeORM entities
// (Purchase, TokenLedger, User), TokensModule, and provides
// PurchasesService and PurchasesController.
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

import { PurchasesService } from "./purchases.service";
import { PurchasesController } from "./purchases.controller";
import { Purchase } from "../database/entities/purchase.entity";
import { TokenLedger } from "../database/entities/token-ledger.entity";
import { User } from "../database/entities/user.entity";
import { TokensModule } from "../tokens/tokens.module";
import { UsersModule } from "../users/users.module";
import { AuditEvent } from "../database/entities/audit-event.entity";
import { HttpModule } from "@nestjs/axios";

@Module({
  imports: [
    TypeOrmModule.forFeature([Purchase, TokenLedger, User, AuditEvent]),
    HttpModule,
    TokensModule,
    UsersModule,
  ],
  providers: [PurchasesService],
  controllers: [PurchasesController],
  exports: [PurchasesService],
})
export class PurchasesModule {}
