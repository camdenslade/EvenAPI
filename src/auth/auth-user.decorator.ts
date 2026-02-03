import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";

/**
 * AuthUser Interface
 *
 * Represents an authenticated Cognito user attached to the request by
 * CognitoAuthGuard.
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  phone: string | null;
  cognitoSub?: string | null;
  appleSub?: string | null;
}

export const AuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request>();

    const user = req.user as AuthUser | undefined;

    if (!user) {
      throw new UnauthorizedException("Missing authenticated user");
    }

    return user;
  },
);
