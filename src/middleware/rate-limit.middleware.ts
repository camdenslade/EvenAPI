//********************************************************************
//
// RateLimitMiddleware Class
//
// Rate limiting middleware using express-rate-limit with Redis backing.
// Prevents abuse of sensitive endpoints (auth, reports, blocks).
// Configurable limits per endpoint type.
//
// Return Value
// ------------
// None (NestJS middleware class)
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

import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { RedisService } from "../redis/redis.service";
import { isAuthRateLimitDisabled } from "../constants/rate-limit-config";

// Only rate-limit abuse-prone routes; keep Redis off hot read paths.
const RATE_LIMITS = {
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: "Too many authentication attempts, please try again later.",
  },
  reports: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: "Too many report requests, please try again later.",
  },
  purchases: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: "Too many purchase verification requests, please try again later.",
  },
  uploads: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30,
    message: "Too many upload requests, please try again later.",
  },
} as const;

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);

  constructor(private readonly redis: RedisService) {}

  private resolveBucket(path: string) {
    if (path.startsWith("/api/auth")) {
      return { key: "auth", ...RATE_LIMITS.auth };
    }
    if (path.startsWith("/api/purchases")) {
      return { key: "purchases", ...RATE_LIMITS.purchases };
    }
    if (path.startsWith("/api/reports")) {
      return { key: "reports", ...RATE_LIMITS.reports };
    }
    if (path.startsWith("/api/s3") || path.startsWith("/api/uploads")) {
      return { key: "uploads", ...RATE_LIMITS.uploads };
    }
    // Non-sensitive routes bypass Redis completely.
    return null;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const bucket = this.resolveBucket(req.path);
    if (!bucket) {
      return next();
    }
    if (bucket.key === "auth" && isAuthRateLimitDisabled()) {
      return next();
    }

    const ip =
      req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown";
    const reqAny = req as unknown as Record<string, unknown>;
    const maybeUser =
      reqAny && typeof reqAny === "object" ? reqAny["user"] : null;
    const uid =
      maybeUser &&
      typeof maybeUser === "object" &&
      maybeUser !== null &&
      "uid" in maybeUser &&
      typeof (maybeUser as Record<string, unknown>).uid === "string"
        ? ((maybeUser as Record<string, unknown>).uid as string)
        : undefined;
    const identifiers: Array<{ key: string; scope: "ip" | "uid" }> = [
      { key: `rl:${bucket.key}:ip:${ip}`, scope: "ip" },
    ];
    if (uid) {
      identifiers.push({
        key: `rl:${bucket.key}:uid:${uid}`,
        scope: "uid",
      });
    }
    const ttlSeconds = Math.ceil(bucket.windowMs / 1000);

    for (const ident of identifiers) {
      try {
        const count = await this.redis.client.incr(ident.key);
        if (count === 1) {
          await this.redis.client.expire(ident.key, ttlSeconds);
        }

        if (count > bucket.max) {
          this.logger.warn(
            `Rate limit triggered bucket=${bucket.key} scope=${ident.scope} ip=${ip} path=${req.path}`,
          );
          res.status(429).json({ message: bucket.message });
          return;
        }
      } catch {
        // Allow request if Redis is unavailable; avoid noisy per-request logs.
        continue;
      }
    }

    return next();
  }
}
