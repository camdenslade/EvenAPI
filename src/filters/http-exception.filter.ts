//********************************************************************
//
// HttpExceptionFilter Class
//
// Global exception filter that formats all HTTP errors as JSON and
// sanitizes responses in production. Removes stack traces, PII, and
// sensitive information from error responses.
//
// Return Value
// ------------
// None (NestJS exception filter class)
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

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { sanitizeForLogging } from "../utils/log-sanitizer";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : "Internal server error";

    // Log raw exception for debugging (server-side only)
    if (exception instanceof Error) {
      console.error("Raw exception:", exception);
      console.error("Stack trace:", exception.stack);
    }

    // TEMPORARY: Log stack traces server-side for diagnosis (single deploy only)
    // TODO: Remove after confirming root cause
    if (exception instanceof Error && status >= 500) {
      this.logger.error("EXCEPTION_STACK", {
        message: exception.message,
        stack: exception.stack,
        path: request.url,
        method: request.method,
        timestamp: new Date().toISOString(),
      });
    }

    // Sanitize message to remove PII
    const sanitizedMessage =
      typeof message === "string"
        ? sanitizeForLogging(message)
        : typeof message === "object" && message !== null
          ? sanitizeForLogging(JSON.stringify(message))
          : "Internal server error";

    // Log error (sanitized)
    const errorLog = {
      statusCode: status,
      message: sanitizedMessage,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error("Server error", errorLog);
    } else {
      this.logger.warn("Client error", errorLog);
    }

    // Build response (no stack traces in production)
    const errorResponse: {
      statusCode: number;
      message: string | object;
      timestamp: string;
      path: string;
    } = {
      statusCode: status,
      message: sanitizedMessage,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // In development, include stack trace (but sanitized)
    if (process.env.NODE_ENV !== "production" && exception instanceof Error) {
      errorResponse["stack"] = sanitizeForLogging(exception.stack || "");
    }

    response.status(status).json(errorResponse);
  }
}
