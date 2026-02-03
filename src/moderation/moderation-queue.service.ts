//********************************************************************
//
// ModerationQueueService Class
//
// Service for managing photo moderation queue using Redis.
// Processes moderation jobs asynchronously via cron.
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
// redis           RedisService            Redis service for queue
// moderation      ModerationService       Moderation service
// photoRepo       Repository<ProfilePhoto>  ProfilePhoto repository
// s3              S3Service               S3 service for generating URLs
//
//*******************************************************************

import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ModerationService } from "./moderation.service";
import { ProfilePhoto } from "../database/entities/profile-photo.entity";
import { RedisService } from "../redis/redis.service";
import { S3Service } from "../s3/s3.service";

@Injectable()
export class ModerationQueueService {
  private readonly logger = new Logger(ModerationQueueService.name);
  private readonly QUEUE_KEY = "moderation:queue";
  private readonly PROCESSING_KEY = "moderation:processing";
  private readonly WORKING_KEY = "moderation:processing:list";
  private readonly MAX_BATCH = 5; // process up to 5 jobs per tick to improve throughput safely

  constructor(
    @InjectRepository(ProfilePhoto)
    private readonly photoRepo: Repository<ProfilePhoto>,
    private readonly moderation: ModerationService,
    private readonly redis: RedisService,
    private readonly s3: S3Service,
  ) {}

  //********************************************************************
  //
  // enqueuePhoto Method
  //
  // Adds a photo to the moderation queue.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // photoId    string    ProfilePhoto UUID
  // imageUrl   string    S3 key or URL
  //
  //*******************************************************************
  async enqueuePhoto(photoId: string, imageUrl: string): Promise<void> {
    const job = JSON.stringify({ photoId, imageUrl });

    await this.redis.safe(() => this.redis.client.lPush(this.QUEUE_KEY, job), {
      op: "lpush",
      key: this.QUEUE_KEY,
    });
    this.logger.log(`Enqueued photo for moderation: ${photoId}`);
  }

  //********************************************************************
  //
  // processQueue Method
  //
  // Processes moderation queue. Called by cron job every 10 seconds.
  // Uses BRPOPLPUSH to move jobs to a working list (at-least-once).
  // Jobs are only removed from the working list after successful processing.
  //
  //*******************************************************************
  @Cron(CronExpression.EVERY_10_SECONDS)
  async processQueue(): Promise<void> {
    // Process up to MAX_BATCH items per tick to avoid blocking
    for (let i = 0; i < this.MAX_BATCH; i++) {
      const jobStr = await this.redis.safe(
        () =>
          this.redis.client.brPopLPush(
            this.QUEUE_KEY,
            this.WORKING_KEY,
            1, // 1 second block to avoid busy looping
          ),
        { op: "brpoplpush", key: `${this.QUEUE_KEY}->${this.WORKING_KEY}` },
      );

      if (!jobStr) {
        break; // no more jobs
      }

      const job = JSON.parse(jobStr) as {
        photoId: string;
        imageUrl: string;
      };

      try {
        await this.processPhoto(job.photoId, job.imageUrl);
        // Remove from working list only after success
        await this.redis.safe(
          () => this.redis.client.lRem(this.WORKING_KEY, 1, jobStr),
          { op: "lrem", key: this.WORKING_KEY },
        );
      } catch (err) {
        // Leave job in working list for retry on next tick
        this.logger.error(
          `Error processing moderation job ${job.photoId}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Requeue any stuck jobs in working list (e.g., crashes mid-process)
    await this.requeueStuckJobs();
  }

  //********************************************************************
  //
  // processPhoto Method
  //
  // Processes a single photo moderation job.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // photoId    string    ProfilePhoto UUID
  // imageUrl   string    S3 key or URL
  //
  //*******************************************************************
  private async processPhoto(photoId: string, imageUrl: string): Promise<void> {
    try {
      const photo = await this.photoRepo.findOne({ where: { id: photoId } });

      if (!photo) {
        this.logger.warn(`Photo not found: ${photoId}`);
        return;
      }

      if (photo.status !== "pending") {
        this.logger.warn(`Photo already processed: ${photoId}`);
        return;
      }

      // Generate S3 read URL for moderation
      const s3Url = await this.s3.createReadUrl(imageUrl, 3600);

      // Moderate the image
      const result = await this.moderation.moderateImage(s3Url);

      // Update photo status
      photo.status = result.status;
      photo.reason = result.reason || null;
      photo.confidence = result.confidence || null;

      await this.photoRepo.save(photo);

      // Track rejected photos for rate limiting
      if (result.status === "rejected") {
        const today = new Date().toISOString().split("T")[0];
        const rejectedKey = `photo_rejected:${photo.userId}:${today}`;

        await this.redis.safe(() => this.redis.client.incr(rejectedKey), {
          op: "incr",
          key: rejectedKey,
        });
        // Set expiration (24 hours)

        await this.redis.safe(
          () => this.redis.client.expire(rejectedKey, 86400),
          { op: "expire", key: rejectedKey },
        );
      }

      this.logger.log(`Photo moderated: ${photoId} -> ${result.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to process photo ${photoId}`,
        error instanceof Error ? error.message : String(error),
      );

      // On failure, flag the photo for manual review
      try {
        const photo = await this.photoRepo.findOne({
          where: { id: photoId },
        });
        if (photo && photo.status === "pending") {
          photo.status = "flagged";
          photo.reason = "Moderation processing failed";
          await this.photoRepo.save(photo);
        }
      } catch {
        this.logger.error(
          `Failed to update photo status after error: ${photoId}`,
        );
      }
    }
  }

  /**
   * Moves any lingering items from the working list back to the queue so they can be retried.
   * This is safe because jobs are idempotent at the queue level (photo status checks).
   */
  private async requeueStuckJobs(): Promise<void> {
    const stuck = await this.redis.safe(
      () => this.redis.client.lRange(this.WORKING_KEY, 0, -1),
      { op: "lrange", key: this.WORKING_KEY },
    );
    if (!stuck || stuck.length === 0) return;

    for (const jobStr of stuck) {
      await this.redis.safe(
        () => this.redis.client.lRem(this.WORKING_KEY, 1, jobStr),
        { op: "lrem", key: this.WORKING_KEY },
      );
      await this.redis.safe(
        () => this.redis.client.lPush(this.QUEUE_KEY, jobStr),
        {
          op: "lpush",
          key: this.QUEUE_KEY,
        },
      );
    }
  }
}
