//********************************************************************
//
// CronJobsService Class
//
// Service for scheduled background jobs. Handles expiring matches
// that have no first message after 14 days and cleaning expired
// hide windows from likes. Runs hourly via NestJS Schedule module.
//
// Return Value
// ------------
// None (NestJS service class)
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
// logger              Logger                  NestJS logger instance
// MATCH_EXPIRATION_MS number                  Match expiration time in milliseconds (14 days)
// HIDE_WINDOW_MS      number                  Hide window duration in milliseconds (30 days)
// matchRepo           Repository<Match>       TypeORM repository for matches
// likeRepo            Repository<Like>        TypeORM repository for likes
//
//*******************************************************************

import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, LessThan, IsNull } from "typeorm";

import { Match } from "../database/entities/match.entity";
import { Like } from "../database/entities/like.entity";

@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);

  private readonly MATCH_EXPIRATION_MS = 14 * 24 * 60 * 60 * 1000;
  private readonly HIDE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(Match)
    private readonly matchRepo: Repository<Match>,

    @InjectRepository(Like)
    private readonly likeRepo: Repository<Like>,
  ) {}

  //********************************************************************
  //
  // expireMatches Method
  //
  // Cron job that runs every hour. Expires matches that have no first
  // message after 14 days. Sets match status to 'expired'.
  //
  // Return Value
  // ------------
  // Promise<void>
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
  // now           number        Current timestamp
  // cutoff        Date          Cutoff date for expiration
  // staleMatches  Match[]       Matches to expire
  // m             Match         Match in loop
  //
  //*******************************************************************
  @Cron(CronExpression.EVERY_HOUR)
  async expireMatches() {
    const now = Date.now();
    const cutoff = new Date(now - this.MATCH_EXPIRATION_MS);

    const staleMatches = await this.matchRepo.find({
      where: {
        firstMessageAt: IsNull(),
        createdAt: LessThan(cutoff),
        status: "active",
      },
    });

    if (staleMatches.length === 0) return;

    this.logger.log(`Expiring ${staleMatches.length} stale matches`);

    for (const m of staleMatches) {
      m.status = "expired";
      await this.matchRepo.save(m);
    }
  }

  //********************************************************************
  //
  // cleanHideWindows Method
  //
  // Cron job that runs every hour. Cleans expired hide windows from
  // likes by setting hiddenUntil to null and isHidden to false.
  //
  // Return Value
  // ------------
  // Promise<void>
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
  // now           Date        Current timestamp
  // expiredHides  Like[]      Likes with expired hide windows
  // like          Like        Like in loop
  //
  //*******************************************************************
  @Cron(CronExpression.EVERY_HOUR)
  async cleanHideWindows() {
    const now = new Date();

    const expiredHides = await this.likeRepo.find({
      where: {
        hiddenUntil: LessThan(now),
      },
    });

    if (expiredHides.length === 0) return;

    this.logger.log(`Cleaning ${expiredHides.length} expired hide windows`);

    for (const like of expiredHides) {
      like.hiddenUntil = null;
      like.isHidden = false;
      await this.likeRepo.save(like);
    }
  }
}
