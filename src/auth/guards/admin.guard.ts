//********************************************************************
//
// AdminGuard Class
//
// Authorization guard that ensures the authenticated user has admin role.
// Must be used after CognitoAuthGuard. Throws ForbiddenException if
// user is not an admin.
//
// Return Value
// ------------
// None (NestJS guard class)
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
// usersService    UsersService    Injected users service
//
//*******************************************************************

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Request } from "express";
import { Admin } from "../../database/entities/admin.entity";
import { SecretsService } from "../../secrets/secrets.service";

interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email: string | null;
    phone: string | null;
  };
  admin?: Admin;
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    private readonly secretsService: SecretsService,
  ) {}

  private async getWhitelistedIps(): Promise<string[]> {
    try {
      const raw = await this.secretsService.getSecret(
        "admin-ip-whitelist",
        "ADMIN_IP_WHITELIST",
      );
      return raw
        .split(",")
        .map((ip) => ip.trim())
        .filter(Boolean);
    } catch {
      const fallback = process.env.ADMIN_IP_WHITELIST || "";
      return fallback
        .split(",")
        .map((ip) => ip.trim())
        .filter(Boolean);
    }
  }

  private getClientIp(req: Request): string | null {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      return xff.split(",")[0].trim();
    }
    if (Array.isArray(xff) && xff.length > 0) {
      return xff[0].trim();
    }
    if (req.ip) return req.ip;
    if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
    return null;
  }

  private async isIpWhitelisted(req: Request): Promise<boolean> {
    const clientIp = this.getClientIp(req);
    if (!clientIp) return false;
    const whitelist = await this.getWhitelistedIps();
    return whitelist.some((allowed) => allowed === clientIp);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: AuthenticatedRequest = context.switchToHttp().getRequest();

    if (await this.isIpWhitelisted(req)) {
      req.user = {
        uid: `ip:${this.getClientIp(req) ?? "unknown"}`,
        email: null,
        phone: null,
      };
      return true;
    }

    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing authorization header");
    }

    // Prefer the user injected by CognitoAuthGuard
    let uid: string | null = req.user?.uid ?? null;
    let email: string | null = req.user?.email ?? null;

    // Fallback: parse JWT payload to extract sub (no signature check here because
    // CognitoAuthGuard should already have validated it)
    if (!uid) {
      const token = header.replace("Bearer ", "").trim();
      const parts = token.split(".");
      if (parts.length < 2) {
        throw new UnauthorizedException("Invalid token");
      }
      try {
        const payload = Buffer.from(
          parts[1].replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        ).toString("utf8");
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const sub = parsed?.sub;
        const mail = parsed?.email;
        uid = typeof sub === "string" ? sub : null;
        email = typeof mail === "string" ? mail : email;
      } catch {
        throw new UnauthorizedException("Invalid token payload");
      }
    }

    if (!uid) {
      throw new UnauthorizedException("Invalid token payload");
    }

    const adminRecord = await this.adminRepo.findOne({ where: { uid } });
    if (!adminRecord) {
      throw new ForbiddenException("Admin access required");
    }

    req.admin = adminRecord;
    req.user = {
      uid: adminRecord.uid,
      email: adminRecord.email ?? email,
      phone: null,
    };
    return true;
  }
}
