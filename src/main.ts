//********************************************************************
//
// bootstrap Function
//
// Application entry point. Creates the NestJS application instance,
// applies global API prefix (/api), and starts the HTTP server on
// port 3000. Loads environment variables from .env file.
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
// app    INestApplication    NestJS application instance
//
//*******************************************************************
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { config } from "dotenv";

import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./filters/http-exception.filter";

config();

const AWS_REGION_PATTERN = /^[a-z]{2}(-[a-z]+){1,3}-\d+$/;

function sanitizeAwsRegion(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!AWS_REGION_PATTERN.test(normalized)) {
    throw new Error(`Invalid AWS_REGION format: ${value}`);
  }
  return normalized;
}

/**
 * Validates required environment variables at startup.
 * Fails fast with clear error messages if any are missing.
 * No dev fallbacks - all required vars must be set.
 */
function validateEnvironment(): void {
  const required = [
    "NODE_ENV",
    "POSTGRES_HOST",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "REDIS_HOST",
    "REDIS_PORT",
    "REDIS_PASSWORD",
    "AWS_S3_BUCKET",
    "PHONE_HASH_SALT",
    "PHONE_HASH_HMAC_SECRET",
    "AWS_REGION",
    "COGNITO_USER_POOL_ID",
    "COGNITO_APP_CLIENT_ID",
    "COGNITO_APP_CLIENT_SECRET",
  ];

  const appleSignInEnabled = process.env.APPLE_SIGN_IN_ENABLED === "true";
  if (appleSignInEnabled) {
    const appleRoots = [
      process.env.APPLE_ROOT_CERT_PEM,
      process.env.APPLE_ROOT_CERT_PEMS,
    ].filter((value) => value && value.length > 0);
    if (appleRoots.length === 0) {
      required.push("APPLE_ROOT_CERT_PEM(S)");
    }
  }

  const missing = required.filter(
    (key) => !process.env[key] || process.env[key]?.length === 0,
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "No dev fallbacks are allowed in production.",
    );
  }

  if (process.env.AWS_REGION) {
    process.env.AWS_REGION = sanitizeAwsRegion(process.env.AWS_REGION);
  }
}

async function bootstrap() {
  // Validate environment variables before starting the app
  validateEnvironment();

  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"], // Structured logging
    // NOTE: Using NestJS built-in logger. For production scale, consider:
    // - Pino or Winston for JSON logs
    // - Log aggregation (CloudWatch, Datadog, etc.)
    // - Structured JSON output for better parsing
  });

  // Global API prefix
  app.setGlobalPrefix("api");

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Reject unknown properties
      transform: true, // Auto-transform payloads
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS configuration
  const frontendOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
    : [];

  const defaultOrigins = [
    "https://evendating.us",
    "https://www.evendating.us",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:5174",
  ];

  const allowedOrigins = [...new Set([...frontendOrigins, ...defaultOrigins])];

  if (process.env.NODE_ENV !== "production") {
    console.log("CORS allowed origins:", allowedOrigins);
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.replace(/\/$/, "");
      const isAllowed = allowedOrigins.some(
        (allowed) => allowed === normalizedOrigin || allowed === origin,
      );

      if (isAllowed) {
        callback(null, true);
      } else {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`CORS blocked origin: ${origin}`);
          console.warn(`Normalized: ${normalizedOrigin}`);
          console.warn(`Allowed origins: ${allowedOrigins.join(", ")}`);
        }
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  await app.listen(process.env.PORT || 3000);
}

void bootstrap();
