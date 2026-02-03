//********************************************************************
//
// Rate limit guards for public forms
//
// Uses Redis to count requests per IP and enforce simple quotas.
//
//********************************************************************

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { RedisService } from "../../redis/redis.service";
import type { Request } from "express";

const getIp = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (
    req.ip ||
    forwardedIp ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "unknown"
  );
};

@Injectable()
export class SupportRateLimitGuard implements CanActivate {
  private readonly windowSeconds = 60 * 60; // 1 hour
  private readonly limit = 3;
  private readonly prefix = "rate:support";

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = getIp(req);
    const key = `${this.prefix}:${ip}`;

    const current =
      (await this.redis.incrementWithTtl(key, this.windowSeconds)) ?? 0;

    if (current > this.limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many support requests, please try again later.",
          retryAfter: this.windowSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

@Injectable()
export class SuggestionsRateLimitGuard implements CanActivate {
  private readonly windowSeconds = 24 * 60 * 60; // 1 day
  private readonly limit = 5;
  private readonly prefix = "rate:suggestions";

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = getIp(req);
    const key = `${this.prefix}:${ip}`;

    const current =
      (await this.redis.incrementWithTtl(key, this.windowSeconds)) ?? 0;

    if (current > this.limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many suggestions, please try again tomorrow.",
          retryAfter: this.windowSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
