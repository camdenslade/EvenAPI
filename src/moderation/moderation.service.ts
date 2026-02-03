//********************************************************************
//
// ModerationService Class
//
// Service for moderating photos using Google Vision SafeSearch API.
// Analyzes images for adult content, violence, and other unsafe content.
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
// visionClient    ImageAnnotatorClient    Google Vision API client
//
//*******************************************************************

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { SecretsService } from "../secrets/secrets.service";
import { sanitizeForLogging } from "../utils/log-sanitizer";

export interface ModerationResult {
  status: "approved" | "flagged" | "rejected";
  reason?: string;
  confidence?: number;
}

@Injectable()
export class ModerationService implements OnModuleInit {
  private readonly logger = new Logger(ModerationService.name);
  private visionClient: ImageAnnotatorClient | null = null;

  constructor(private readonly secretsService: SecretsService) {}

  async onModuleInit(): Promise<void> {
    try {
      // Google Vision API uses Application Default Credentials
      // Set GOOGLE_VISION_CREDENTIALS env var or use service account key
      const credentialsPath =
        process.env.GOOGLE_VISION_CREDENTIALS ||
        (await this.secretsService.getSecret(
          "google-vision-credentials",
          "GOOGLE_VISION_CREDENTIALS",
        ));

      if (credentialsPath) {
        const allowFileSecrets =
          process.env.ALLOW_FILE_BASED_SECRETS === "true";

        // Try parsing credentials as JSON string first
        try {
          const jsonCreds = JSON.parse(credentialsPath) as {
            client_email: string;
            private_key: string;
          };
          this.visionClient = new ImageAnnotatorClient({
            credentials: jsonCreds,
          });
          this.logger.log("Google Vision API client initialized from JSON");
        } catch {
          if (!allowFileSecrets) {
            this.logger.error(
              "GOOGLE_VISION_CREDENTIALS must be JSON; file paths blocked unless ALLOW_FILE_BASED_SECRETS=true",
            );
            return;
          }

          // Fallback: treat as file path when explicitly allowed
          this.visionClient = new ImageAnnotatorClient({
            keyFilename: credentialsPath,
          });
          this.logger.log("Google Vision API client initialized from file");
        }
      } else {
        this.logger.warn(
          "Google Vision API credentials not found. Moderation will be disabled.",
        );
      }
    } catch (error) {
      this.logger.error(
        "Failed to initialize Google Vision API client",
        error instanceof Error
          ? sanitizeForLogging(error.message)
          : sanitizeForLogging(String(error)),
      );
      // Continue without moderation - fail gracefully
    }
  }

  //********************************************************************
  //
  // moderateImage Method
  //
  // Moderates an image using Google Vision SafeSearch API.
  // Returns moderation result with status, reason, and confidence.
  //
  // Return Value
  // ------------
  // Promise<ModerationResult>    Moderation result
  //
  // Value Parameters
  // ----------------
  // imageUrl    string    S3 URL or public image URL
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // result      SafeSearchAnnotation    SafeSearch API result
  // adult       Likelihood              Adult content likelihood
  // violence    Likelihood              Violence likelihood
  // racy        Likelihood              Racy content likelihood
  // maxConfidence  number               Maximum confidence score
  //
  //*******************************************************************
  async moderateImage(imageUrl: string): Promise<ModerationResult> {
    if (!this.visionClient) {
      // If Vision API is not available, default to approved
      // This allows the system to continue functioning
      this.logger.warn(
        `Vision API not available, approving image: ${imageUrl}`,
      );
      return { status: "approved" };
    }

    try {
      const [result] = await this.visionClient.safeSearchDetection(imageUrl);

      if (!result.safeSearchAnnotation) {
        this.logger.warn(`No SafeSearch annotation for ${imageUrl}`);
        return { status: "approved" };
      }

      const annotation = result.safeSearchAnnotation;
      const adult = annotation.adult || "UNKNOWN";
      const violence = annotation.violence || "UNKNOWN";
      const racy = annotation.racy || "UNKNOWN";
      const spoof = annotation.spoof || "UNKNOWN";

      // Map Likelihood enum to numeric confidence (0-1)
      const likelihoodMap: Record<string, number> = {
        UNKNOWN: 0,
        VERY_UNLIKELY: 0.1,
        UNLIKELY: 0.3,
        POSSIBLE: 0.5,
        LIKELY: 0.8,
        VERY_LIKELY: 1.0,
      };

      const adultConf = likelihoodMap[adult] || 0;
      const violenceConf = likelihoodMap[violence] || 0;
      const racyConf = likelihoodMap[racy] || 0;
      const spoofConf = likelihoodMap[spoof] || 0;
      const maxConfidence = Math.max(
        adultConf,
        violenceConf,
        racyConf,
        spoofConf,
      );

      // Reject hard for explicit nudity/lewd (adult/racy) or obvious violence or spoof/bot
      if (adult === "VERY_LIKELY" || racy === "VERY_LIKELY") {
        return {
          status: "rejected",
          reason: "Adult or lewd content detected",
          confidence: maxConfidence,
        };
      }

      if (violence === "VERY_LIKELY") {
        return {
          status: "rejected",
          reason: "Violence detected",
          confidence: violenceConf,
        };
      }

      if (spoof === "VERY_LIKELY") {
        return {
          status: "rejected",
          reason: "Spoof/bot image detected",
          confidence: spoofConf,
        };
      }

      // Flag borderline adult/lewd/spoof (keep in app but queue for review)
      if (adult === "LIKELY" || racy === "LIKELY" || spoof === "LIKELY") {
        return {
          status: "flagged",
          reason: "Potentially inappropriate or fake content",
          confidence: maxConfidence,
        };
      }

      // Otherwise approved
      return {
        status: "approved",
        confidence: maxConfidence,
      };
    } catch (error) {
      this.logger.error(
        `Failed to moderate image ${imageUrl}`,
        error instanceof Error
          ? sanitizeForLogging(error.message)
          : sanitizeForLogging(String(error)),
      );
      // On error, default to flagged (safer than approved)
      return {
        status: "flagged",
        reason: "Moderation check failed",
      };
    }
  }
}
