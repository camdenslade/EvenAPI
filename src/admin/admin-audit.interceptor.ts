//********************************************************************
//
// AdminAuditInterceptor
//
// Intercepts admin requests to record audit events with method/path
// and actor UID. Best-effort logging; does not block requests on
// failure.
//
//********************************************************************

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { AuditEvent } from "../database/entities/audit-event.entity";
import { sanitizeForLogging } from "../utils/log-sanitizer";

function getString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || obj === null) return undefined;
  const val = (obj as Record<string, unknown>)[key];
  return typeof val === "string" ? val : undefined;
}

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req: unknown = context.switchToHttp().getRequest();

    const maybeUser: unknown =
      req && typeof req === "object"
        ? (req as Record<string, unknown>)["user"]
        : undefined;
    const actorUid = getString(maybeUser, "uid") ?? "unknown";

    const eventPayload = {
      actorUid,
      method: getString(req, "method") ?? "unknown",
      path: getString(req, "originalUrl") ?? getString(req, "url") ?? "unknown",
    };

    void this.auditRepo
      .insert({ event: "ADMIN_HTTP_ACCESS", payload: eventPayload })
      .catch((err) =>
        console.error(
          `Failed to persist admin access audit: ${sanitizeForLogging(
            err instanceof Error ? err.message : String(err),
          )}`,
        ),
      );

    return next.handle().pipe(
      tap(() => {
        // no-op on success; logging already done
      }),
    );
  }
}
