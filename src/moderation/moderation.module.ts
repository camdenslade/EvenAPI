import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ModerationService } from "./moderation.service";
import { ModerationQueueService } from "./moderation-queue.service";
import { ProfilePhoto } from "../database/entities/profile-photo.entity";
import { SecretsModule } from "../secrets/secrets.module";
import { S3Module } from "../s3/s3.module";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([ProfilePhoto]),
    SecretsModule,
    S3Module,
    RedisModule,
  ],
  providers: [ModerationService, ModerationQueueService],
  exports: [ModerationService, ModerationQueueService],
})
export class ModerationModule {}
