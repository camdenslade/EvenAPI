//********************************************************************
//
// BlocksModule Class
//
// Module for block management. Provides BlocksController and BlocksService
// for handling user blocks and persistent safety exclusions.
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

import { Block } from "../database/entities/block.entity";
import { SafetyExclusion } from "../database/entities/safety-exclusion.entity";
import { SafetyIdentity } from "../database/entities/safety-identity.entity";
import { User } from "../database/entities/user.entity";

import { BlocksController } from "./blocks.controller";
import { BlocksService } from "./blocks.service";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Block, SafetyExclusion, SafetyIdentity, User]),
    RedisModule,
  ],
  controllers: [BlocksController],
  providers: [BlocksService],
  exports: [BlocksService], // Export for use in other modules (e.g., ProfilesService)
})
export class BlocksModule {}
