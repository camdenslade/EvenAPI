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

    // Sanitize message to remove PII
    // NestJS HttpException.getResponse() returns an object like { statusCode, message, error }
    // Extract just the message string rather than stringifying the whole object.
    const rawMessage =
      typeof message === "string"
        ? message
        : typeof message === "object" && message !== null && "message" in message
          ? String((message as { message: unknown }).message)
          : "Internal server error";
    const sanitizedMessage = sanitizeForLogging(rawMessage);

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
