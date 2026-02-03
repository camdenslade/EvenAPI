//********************************************************************
//
// SecretsService Class
//
// Service for fetching secrets from AWS Secrets Manager with fallback
// to environment variables. Provides a centralized way to access all
// application secrets.
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
// secretsCache    Map<string, string>    Cache for fetched secrets
// client          SecretsManagerClient   AWS Secrets Manager client
//
//*******************************************************************

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { sanitizeForLogging } from "../utils/log-sanitizer";

@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly logger = new Logger(SecretsService.name);
  private secretsCache = new Map<string, string>();

  private client: SecretsManagerClient | null = null;
  private readonly region = process.env.AWS_REGION || "us-east-1";
  private readonly secretsPrefix = process.env.SECRETS_PREFIX || "even/alpha";

  onModuleInit(): void {
    // Initialize AWS Secrets Manager client
    // Note: IAM roles will be used automatically if available, no explicit credentials needed
    try {
      this.client = new SecretsManagerClient({
        region: this.region,
      });
      this.logger.log("AWS Secrets Manager client initialized");
    } catch (err) {
      this.logger.warn(
        `Failed to initialize AWS Secrets Manager client, will use env vars only: ${
          err instanceof Error
            ? sanitizeForLogging(err.message)
            : sanitizeForLogging(String(err))
        }`,
      );
      // Client remains null, will fall back to env vars
    }
  }

  /**
   * Gets a secret value from AWS Secrets Manager or environment variable.
   * Falls back to environment variable if Secrets Manager is unavailable.
   *
   * @param secretName - Name of the secret in Secrets Manager (without prefix)
   * @param envVarName - Environment variable name to use as fallback
   * @returns Secret value as string
   */
  async getSecret(secretName: string, envVarName: string): Promise<string> {
    // Check cache first
    const cacheKey = `${secretName}:${envVarName}`;
    if (this.secretsCache.has(cacheKey)) {
      return this.secretsCache.get(cacheKey)!;
    }

    // Try AWS Secrets Manager first
    if (this.client) {
      try {
        const fullSecretName = `${this.secretsPrefix}/${secretName}`;

        const response = await this.client.send(
          new GetSecretValueCommand({
            SecretId: fullSecretName,
            VersionStage: "AWSCURRENT",
          }),
        );

        if (response.SecretString) {
          const value: string = response.SecretString;
          this.secretsCache.set(cacheKey, value);
          this.logger.log(`Retrieved secret from AWS: ${fullSecretName}`);
          return value;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to fetch secret from AWS Secrets Manager: ${secretName}. ` +
            `Falling back to environment variable: ${envVarName}. ` +
            `Error: ${
              err instanceof Error
                ? sanitizeForLogging(err.message)
                : sanitizeForLogging(String(err))
            }`,
        );
      }
    }

    // Fallback to environment variable
    const envValue = process.env[envVarName];
    if (envValue) {
      this.secretsCache.set(cacheKey, envValue);
      this.logger.log(`Using environment variable: ${envVarName}`);
      return envValue;
    }

    throw new Error(
      `Secret not found: ${secretName}. ` +
        `Neither AWS Secrets Manager nor environment variable ${envVarName} is available.`,
    );
  }

  /**
   * Gets a secret value synchronously (from cache or env var only).
   * Use this for initialization code that can't be async.
   *
   * @param envVarName - Environment variable name
   * @returns Secret value as string or undefined
   */
  getSecretSync(envVarName: string): string | undefined {
    return process.env[envVarName];
  }
}
