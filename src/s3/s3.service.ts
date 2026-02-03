//********************************************************************
//
// S3Service Class
//
// Service for managing AWS S3 operations. Handles creating pre-signed
// upload URLs for direct client uploads and deleting objects from S3.
// Uses IAM role authentication (no access keys).
//
//*******************************************************************

import {
  Injectable,
  BadRequestException,
  OnModuleInit,
  Logger,
} from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SecretsService } from "../secrets/secrets.service";
import { sanitizeForLogging } from "../utils/log-sanitizer";

/**
 * Allowed MIME types for uploads
 */
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

/**
 * Maximum file size (10 MB)
 */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Allowed key prefix to prevent path traversal or cross-bucket access.
 * All generated keys are under uploads/.
 */
const ALLOWED_KEY_PREFIX = "uploads/";

/**
 * AWS region (NOT a secret)
 * Safe to hardcode for single-region deployment.
 */
const AWS_REGION = "us-east-1"; // change later via env if desired

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);

  private s3!: S3Client;
  private bucket!: string;

  constructor(private readonly secretsService: SecretsService) {}

  async onModuleInit(): Promise<void> {
    /**
     * Bucket name is configuration, not a credential.
     * Can come from Secrets Manager or env.
     */
    const bucket =
      process.env.AWS_S3_BUCKET ??
      (await this.secretsService.getSecret("aws-s3-bucket", "AWS_S3_BUCKET"));

    if (!bucket) {
      throw new Error("Missing required configuration: AWS_S3_BUCKET");
    }

    this.bucket = bucket;

    /**
     * IMPORTANT:
     * Do NOT pass credentials.
     * AWS SDK will automatically use the EC2 IAM role.
     */
    this.s3 = new S3Client({
      region: AWS_REGION,
      forcePathStyle: false,
      tls: true,
    });

    this.logger.log(`S3Service initialized for bucket "${this.bucket}"`);
  }

  private ensureKeySafe(key: string): void {
    if (!key || typeof key !== "string") {
      throw new BadRequestException("Missing S3 object key");
    }

    if (
      key.includes("..") ||
      key.includes("\\") ||
      key.startsWith("/") ||
      key.startsWith("s3://") ||
      key.length > 512
    ) {
      throw new BadRequestException("Invalid S3 object key");
    }

    if (!key.startsWith(ALLOWED_KEY_PREFIX)) {
      throw new BadRequestException("Invalid S3 key prefix");
    }
  }

  //********************************************************************
  // createUploadUrl
  //********************************************************************
  async createUploadUrl(
    contentType?: string | null,
    fileSize?: number | null,
  ): Promise<{ uploadUrl: string; key: string }> {
    const mimeType = contentType ?? "image/jpeg";

    if (
      !ALLOWED_MIME_TYPES.includes(
        mimeType as (typeof ALLOWED_MIME_TYPES)[number],
      )
    ) {
      throw new BadRequestException(`Unsupported content type: ${mimeType}`);
    }

    if (fileSize !== undefined && fileSize !== null) {
      if (fileSize <= 0) {
        throw new BadRequestException("File size must be greater than 0");
      }
      if (fileSize > MAX_FILE_SIZE_BYTES) {
        throw new BadRequestException(
          `File size exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
        );
      }
    }

    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };

    const ext = extMap[mimeType] ?? "jpg";

    const key = `${ALLOWED_KEY_PREFIX}${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ACL: "private",
      ServerSideEncryption: "AES256",
      // Note: omit Tagging to avoid requiring s3:PutObjectTagging permission
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: 300, // 5 minutes
    });

    const secureUploadUrl = uploadUrl.replace(/^http:/, "https:");

    this.logger.log(`Generated presigned upload URL (${mimeType})`);

    return {
      uploadUrl: secureUploadUrl,
      key,
    };
  }

  //********************************************************************
  // createReadUrl
  //********************************************************************
  async createReadUrl(
    key: string,
    expiresInSeconds = 900, // default 15 minutes to reduce exposure
  ): Promise<string> {
    this.ensureKeySafe(key);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      const url = await getSignedUrl(this.s3, command, {
        expiresIn: expiresInSeconds,
      });

      return url.replace(/^http:/, "https:");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : sanitizeForLogging(String(err));
      this.logger.error(
        `Failed to generate presigned GET URL for ${key}: ${sanitizeForLogging(
          msg,
        )}`,
      );
      throw new Error("Failed to generate image URL");
    }
  }

  //********************************************************************
  // deleteObject
  //********************************************************************
  async deleteObject(key: string): Promise<void> {
    try {
      this.ensureKeySafe(key);
    } catch {
      return; // ignore invalid keys to avoid leaking info
    }

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      await this.s3.send(command);
      this.logger.log(`Deleted S3 object: ${key}`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : sanitizeForLogging(String(err));
      this.logger.error(
        `Failed to delete S3 object: ${key}: ${sanitizeForLogging(msg)}`,
      );
    }
  }
}
