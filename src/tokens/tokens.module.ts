//********************************************************************
//
// TokensModule Class
//
// Module for token entitlement management. Imports TypeORM entities
// (TokenLedger, User) and provides TokensService for token grants,
// consumption, and availability calculation.
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

import { TokensService } from "./tokens.service";
import { TokenLedger } from "../database/entities/token-ledger.entity";
import { User } from "../database/entities/user.entity";
import { AuditEvent } from "../database/entities/audit-event.entity";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenLedger, User, AuditEvent]),
    RedisModule,
  ],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
