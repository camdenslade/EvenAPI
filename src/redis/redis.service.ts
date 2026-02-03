//********************************************************************
//
// RedisService Class
//
// Service for managing Redis operations. Handles connection lifecycle,
// basic string operations, and JSON serialization/deserialization.
// Used primarily for caching swipe queues and other frequently accessed
// data. Implements OnModuleInit and OnModuleDestroy for connection management.
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
// none
//
//*******************************************************************

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { createClient } from "redis";
import { SecretsService } from "../secrets/secrets.service";

// Use ReturnType to get the actual client type from createClient
type RedisClient = ReturnType<typeof createClient>;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redisClient!: RedisClient;
  private readonly logger = new Logger(RedisService.name);
  private isReady = false;
  private readonly defaultJitterRatio = 0.1; // +/-10% TTL jitter

  constructor(private readonly secretsService: SecretsService) {}

  private telemetry(event: string, data: Record<string, unknown>) {
    this.logger.log(JSON.stringify({ metric: "redis", event, ...data }));
  }

  private jitterTtl(ttlSeconds: number | undefined): number | undefined {
    if (!ttlSeconds) return ttlSeconds;
    const delta = ttlSeconds * this.defaultJitterRatio;
    const jittered = ttlSeconds + (Math.random() * 2 - 1) * delta;
    return Math.max(1, Math.round(jittered));
  }

  //********************************************************************
  //
  // onModuleInit Method
  //
  // Initializes Redis client connection on module initialization.
  // Sets up error handler and connects to Redis server. Ensures Redis
  // authentication password is explicitly passed to prevent NOAUTH errors.
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
  // redisUrl       string|undefined    Redis connection URL
  // redisPassword  string|undefined    Redis authentication password
  // err            Error               Redis error object
  //
  //*******************************************************************
  async onModuleInit() {
    // Get Redis connection URL (supports REDIS_URL or REDIS_HOST/REDIS_PORT)
    let redisUrl: string | undefined;
    const redisHost = this.secretsService.getSecretSync("REDIS_HOST");
    const redisPort = this.secretsService.getSecretSync("REDIS_PORT") || "6379";
    if (redisHost) {
      redisUrl = `redis://${redisHost}:${redisPort}`;
    } else {
      // Otherwise try REDIS_URL (secret or env)
      try {
        redisUrl = await this.secretsService.getSecret(
          "redis-url",
          "REDIS_URL",
        );
      } catch {
        /* ignore */
      }
    }

    if (!redisUrl) {
      throw new Error(
        "Redis connection string not found. Set REDIS_URL or REDIS_HOST environment variable.",
      );
    }

    // Get Redis password from SecretsService (required for authentication)
    // REDIS_PASSWORD is validated as required in main.ts, so it must exist
    const redisPassword = this.secretsService.getSecretSync("REDIS_PASSWORD");

    // Runtime safety: Fail fast if password is missing (protects against refactors)
    if (!redisPassword || redisPassword.trim().length === 0) {
      throw new Error(
        "REDIS_PASSWORD is required but not found. Redis authentication cannot proceed without a password.",
      );
    }

    // Create Redis client with explicit password authentication
    // Always pass password explicitly to createClient() - do NOT rely on URL parsing
    this.redisClient = createClient({
      url: redisUrl,
      password: redisPassword,
      socket: {
        reconnectStrategy: (retries: number) =>
          Math.min(1000 * 2 ** retries, 30000), // capped exponential backoff
      },
      name: "even-backend-cache",
    });

    this.redisClient.on("error", (err: Error) => {
      const sanitized = err?.message
        ? err.message.replace(/password|token|secret/gi, "[REDACTED]")
        : "[REDACTED]";
      this.logger.error(`Redis error: ${sanitized}`);
      this.telemetry("error", { message: sanitized });
    });

    this.redisClient.on("connect", () => {
      this.logger.log("Redis connecting");
      this.telemetry("connect", {});
    });

    this.redisClient.on("ready", () => {
      this.isReady = true;
      this.logger.log("Redis ready");
      this.telemetry("ready", {});
    });

    this.redisClient.on("reconnecting", (delay) => {
      this.isReady = false;
      this.logger.warn(
        `Redis reconnecting in ${delay as number}ms (backoff enabled)`,
      );
      this.telemetry("reconnecting", { delayMs: delay as number });
    });

    this.redisClient.on("end", () => {
      this.isReady = false;
      this.logger.warn("Redis connection closed");
      this.telemetry("end", {});
    });

    try {
      await this.redisClient.connect();
      this.logger.log("Redis connected");
    } catch (err) {
      const sanitized = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to connect to Redis: ${sanitized}`);
      throw err;
    }
  }

  //********************************************************************
  //
  // onModuleDestroy Method
  //
  // Closes Redis client connection on module destruction. Silently
  // handles shutdown errors.
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
  // None
  //
  //*******************************************************************
  async onModuleDestroy() {
    try {
      if (this.redisClient) {
        await this.redisClient.quit();
      }
    } catch {
      /* ignore shutdown errors */
    }
  }

  //********************************************************************
  //
  // get Method
  //
  // Gets a string value from Redis by key.
  //
  // Return Value
  // ------------
  // Promise<string | null>    Value or null if not found
  //
  // Value Parameters
  // ----------------
  // key    string    Redis key
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
  async get(key: string): Promise<string | null> {
    return this.redisClient.get(key);
  }

  //********************************************************************
  //
  // set Method
  //
  // Sets a string value in Redis by key. Optionally sets TTL in seconds.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // key         string        Redis key
  // value       string        Value to store
  // ttlSeconds  number|undefined Optional TTL in seconds
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
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redisClient.set(key, value, { EX: ttlSeconds });
    } else {
      await this.redisClient.set(key, value);
    }
  }

  //********************************************************************
  //
  // delete Method
  //
  // Deletes a key from Redis.
  //
  // Return Value
  // ------------
  // Promise<number>    Number of keys deleted
  //
  // Value Parameters
  // ----------------
  // key    string    Redis key to delete
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
  async delete(key: string): Promise<number> {
    return this.redisClient.del(key);
  }

  //********************************************************************
  //
  // increment Method
  //
  // Increments a numeric value in Redis by 1. Returns the new value.
  //
  // Return Value
  // ------------
  // Promise<number>    New incremented value
  //
  // Value Parameters
  // ----------------
  // key    string    Redis key
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // result    number    Result from Redis increment operation
  //
  //*******************************************************************
  async increment(key: string): Promise<number> {
    const result = await this.redisClient.incr(key);
    return Number(result);
  }

  //********************************************************************
  //
  // getJson Method
  //
  // Gets a JSON value from Redis by key. Deserializes JSON string
  // and returns typed object. Returns null if key doesn't exist or
  // JSON is invalid.
  //
  // Return Value
  // ------------
  // Promise<T | null>    Deserialized object or null
  //
  // Value Parameters
  // ----------------
  // key    string    Redis key
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // raw    string|null    Raw JSON string from Redis
  //
  //*******************************************************************
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redisClient.get(key);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  //********************************************************************
  //
  // setJson Method
  //
  // Sets a JSON value in Redis by key. Serializes object to JSON string
  // and stores it. Optionally sets TTL in seconds.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // key         string        Redis key
  // value       any           Object to serialize and store
  // ttlSeconds  number|undefined Optional TTL in seconds
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // serialized    string    JSON string representation of value
  //
  //*******************************************************************
  async setJson(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);

    const ttl = this.jitterTtl(ttlSeconds);
    if (ttl) {
      await this.redisClient.set(key, serialized, { EX: ttl });
    } else {
      await this.redisClient.set(key, serialized);
    }
  }

  //********************************************************************
  //
  // safe Method
  //
  // Wraps Redis operations in try-catch to prevent request failures.
  // Cache operations are best-effort and should never fail a request.
  //
  // Return Value
  // ------------
  // Promise<T | null>    Result or null on failure
  //
  // Value Parameters
  // ----------------
  // op      Function    Async function that performs Redis operation
  // meta    object      Metadata for logging (op, key, etc.)
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
  async safe<T>(
    op: () => Promise<T>,
    meta: { op: string; key?: string; [key: string]: any },
  ): Promise<T | null> {
    try {
      const started = Date.now();
      const result = await op();
      this.telemetry("success", {
        ...meta,
        latencyMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      this.logger.error("REDIS_FAIL", {
        ...meta,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  //********************************************************************
  //
  // getOrSetJson Method
  //
  // Read-through helper that attempts to fetch a cached JSON value and,
  // on miss, computes it via the provided fetcher, stores it with an
  // optional TTL (with jitter), and returns the value. Optional soft
  // lock prevents dogpile on cold keys.
  //
  //********************************************************************
  async getOrSetJson<T>(params: {
    key: string;
    ttlSeconds: number;
    fetcher: () => Promise<T | null>;
    lockTtlSeconds?: number;
  }): Promise<T | null> {
    const { key, ttlSeconds, fetcher, lockTtlSeconds } = params;

    const cached = await this.safe<T | null>(() => this.getJson<T>(key), {
      op: "getJson",
      key,
    });
    if (cached !== null && cached !== undefined) {
      this.telemetry("cache_hit", { key });
      return cached;
    }

    this.telemetry("cache_miss", { key });

    const lockKey = `lock:${key}`;
    const lockTtl = lockTtlSeconds ?? Math.min(ttlSeconds, 5);
    let lockAcquired = false;

    if (lockTtl > 0) {
      const lock = await this.safe<string | null>(
        () =>
          this.redisClient.set(lockKey, "1", {
            NX: true,
            EX: lockTtl,
          }),
        { op: "setnx", key: lockKey, ttlSeconds: lockTtl },
      );
      lockAcquired = lock === "OK";

      if (!lockAcquired) {
        // Another worker is computing; re-check cache once before giving up.
        const retry = await this.safe<T | null>(() => this.getJson<T>(key), {
          op: "getJson",
          key,
          attempt: "after_lock_failure",
        });
        if (retry !== null && retry !== undefined) {
          this.telemetry("cache_hit_after_wait", { key });
          return retry;
        }
      }
    }

    const value = await fetcher();
    if (value !== null && value !== undefined) {
      await this.safe(() => this.setJson(key, value, ttlSeconds), {
        op: "setJson",
        key,
        ttlSeconds,
      });
    }

    if (lockAcquired) {
      await this.safe(() => this.redisClient.del(lockKey), {
        op: "delete",
        key: lockKey,
      });
    }

    return value;
  }

  //********************************************************************
  //
  // getCacheVersion Method
  //
  // Retrieves the per-user cache version. Defaults to 1 if missing or
  // invalid. No TTL is applied.
  //
  //********************************************************************
  async getCacheVersion(uid: string): Promise<number> {
    const key = `cache:version:${uid}`;
    const raw = await this.safe<string | null>(
      () => this.redisClient.get(key),
      {
        op: "get",
        key,
      },
    );
    if (!raw) return 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.floor(parsed);
  }

  //********************************************************************
  //
  // bumpCacheVersion Method
  //
  // Increments the per-user cache version. Returns the new version.
  //
  //********************************************************************
  async bumpCacheVersion(uid: string): Promise<number | null> {
    const key = `cache:version:${uid}`;
    return this.safe<number>(() => this.redisClient.incr(key), {
      op: "incr",
      key,
    });
  }

  //********************************************************************
  //
  // getClient Method
  //
  // Returns the Redis client for advanced operations (queue, etc.).
  //
  // Return Value
  // ------------
  // RedisClient    Redis client instance
  //
  //*******************************************************************
  get client(): RedisClient {
    return this.redisClient;
  }

  //********************************************************************
  //
  // incrementWithTtl Method
  //
  // Atomically increments a key and sets expiry when first created.
  //
  //********************************************************************
  async incrementWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<number | null> {
    return this.safe<number>(
      async () => {
        const current = await this.redisClient.incr(key);
        if (current === 1) {
          await this.redisClient.expire(key, ttlSeconds);
        }
        return current;
      },
      {
        op: "incr",
        key,
        ttlSeconds,
      },
    );
  }

  //********************************************************************
  //
  // healthCheck Method
  //
  // Performs a lightweight ping to verify Redis connectivity.
  //
  //********************************************************************
  async healthCheck(): Promise<boolean> {
    if (!this.redisClient) return false;
    try {
      const res = await this.redisClient.ping();
      return res === "PONG";
    } catch (err) {
      this.logger.warn(
        `Redis ping failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }
}
