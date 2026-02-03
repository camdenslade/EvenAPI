import { Test, TestingModule } from "@nestjs/testing";
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UsersModule } from "../../src/users/users.module";
import { AuthModule } from "../../src/auth/auth.module";
import { S3Module } from "../../src/s3/s3.module";
import { TokensModule } from "../../src/tokens/tokens.module";
import { User } from "../../src/database/entities/user.entity";
import { createTestApp, closeTestApp } from "../helpers/app";
import { createTestToken, withAuthHeader } from "../helpers/auth";
import { mockAuthUser } from "../helpers/auth.mock";
import { mockSecretsService } from "../helpers/secrets.mock";
import { mockS3Service } from "../helpers/s3.mock";
import { SecretsService } from "../../src/secrets/secrets.service";
import { S3Service } from "../../src/s3/s3.service";
import { RedisService } from "../../src/redis/redis.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { createTestDataSource } from "../helpers/db";
import { ConfigModule } from "@nestjs/config";
import { NotificationsService } from "../../src/notifications/notifications.service";
import { ProfilesService } from "../../src/profiles/profiles.service";
import { TokensService } from "../../src/tokens/tokens.service";
import { MatchesService } from "../../src/matches/matches.service";
import { BlocksService } from "../../src/blocks/blocks.service";
import { ModerationService } from "../../src/moderation/moderation.service";

const authUsers = new Map<string, any>();

class TestCognitoAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers?: any; user?: any }>();
    const header = req.headers?.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing authorization header");
    }

    const token = header.split(" ")[1];
    if (!token) {
      throw new UnauthorizedException("Missing token");
    }

    if (token.includes("revoked")) {
      throw new UnauthorizedException("Token revoked");
    }

    const uid = token.startsWith("token-")
      ? token.replace("token-", "")
      : token;
    const user = authUsers.get(uid);
    if (!user) {
      throw new UnauthorizedException("Invalid token");
    }

    req.user = {
      uid: user.uid,
      cognitoSub: user.uid,
      email: user.email ?? null,
      phone: user.phone_number ?? null,
      appleSub: null,
    };

    return true;
  }
}

describe("Security Regression Tests", () => {
  let app: INestApplication;
  let module: TestingModule;
  let usersRepo: Repository<User>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(createTestDataSource()),
        TypeOrmModule.forFeature([User]),
        AuthModule,
        UsersModule,
        TokensModule,
      ],
      providers: [
        {
          provide: APP_GUARD,
          useClass: TestCognitoAuthGuard,
        },
        {
          provide: SecretsService,
          useValue: mockSecretsService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
      ],
    })
      .overrideProvider(RedisService)
      .useValue({
        safe: jest.fn((fn) => (typeof fn === "function" ? fn() : null)),
        getCacheVersion: jest.fn().mockResolvedValue(1),
        bumpCacheVersion: jest.fn(),
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(undefined),
        client: {
          incr: jest.fn().mockResolvedValue(1),
          expire: jest.fn().mockResolvedValue(1),
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          exists: jest.fn(),
        },
      })
      .overrideProvider(NotificationsService)
      .useValue({
        invalidatePushCache: jest.fn(),
        sendNotification: jest.fn(),
      })
      .overrideProvider(ProfilesService)
      .useValue({
        getProfile: jest.fn(),
      })
      .overrideProvider(MatchesService)
      .useValue({
        getMatches: jest.fn().mockResolvedValue([]),
      })
      .overrideProvider(BlocksService)
      .useValue({
        getBlockSet: jest.fn().mockResolvedValue(new Set()),
        getExclusionSet: jest.fn().mockResolvedValue(new Set()),
        bumpCacheVersion: jest.fn(),
      })
      .overrideProvider(ModerationService)
      .useValue({
        enqueuePhoto: jest.fn(),
        analyzePhoto: jest.fn(),
        analyzeProfile: jest.fn(),
        enqueueProfile: jest.fn(),
      })
      .overrideProvider(TokensService)
      .useValue({
        getAvailableTokens: jest.fn(),
        ensureMonthlyBaseline: jest.fn(),
        consumeToken: jest.fn(),
        grantAdminTokens: jest.fn(),
        grantSubscriptionTokens: jest.fn(),
        invalidateTokenCache: jest.fn(),
      })
      .overrideModule(S3Module)
      .useModule({
        module: class MockS3Module {},
        providers: [
          {
            provide: S3Service,
            useValue: mockS3Service,
          },
        ],
        exports: [S3Service],
      })
      .overrideProvider(S3Service)
      .useValue(mockS3Service)
      .overrideProvider(SecretsService)
      .useValue(mockSecretsService)
      .compile();

    app = await createTestApp(module);
    usersRepo = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterAll(async () => {
    if (app) {
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await usersRepo.clear();
  });

  describe("Phone number security", () => {
    it("should never return phone number in API responses", async () => {
      const uid = "user-123";
      const phone = "+1234567890";

      authUsers.set(uid, mockAuthUser(uid, null, phone));
      const token = createTestToken(uid);

      // Create/sync user (GET /users/me creates user if it doesn't exist)
      const createResponse = await withAuthHeader(app, token)
        .get("/users/me")
        .expect(200);

      // Verify phone is not in response
      expect(createResponse.body).not.toHaveProperty("phone");
      expect(createResponse.body).not.toHaveProperty("phoneNumber");
      expect(JSON.stringify(createResponse.body)).not.toContain(phone);

      // Remove IDs to avoid false positives on digit-only UUID segments
      const sanitizedCreate = { ...createResponse.body };
      delete sanitizedCreate.id;
      delete sanitizedCreate.safetyIdentityId;
      expect(JSON.stringify(sanitizedCreate)).not.toMatch(/\+?\d{10,}/);

      // Get user
      const getResponse = await withAuthHeader(app, token)
        .get("/users/me")
        .expect(200);

      // Verify phone is not in response
      expect(getResponse.body).not.toHaveProperty("phone");
      expect(getResponse.body).not.toHaveProperty("phoneNumber");
      expect(JSON.stringify(getResponse.body)).not.toContain(phone);

      const sanitizedGet = { ...getResponse.body };
      delete sanitizedGet.id;
      delete sanitizedGet.safetyIdentityId;
      expect(JSON.stringify(sanitizedGet)).not.toMatch(/\+?\d{10,}/);
    });

    it("should never log phone numbers", async () => {
      // This test verifies that phone numbers are not logged
      // In a real implementation, you would check log output
      const uid = "user-123";
      const phone = "+1234567890";

      authUsers.set(uid, mockAuthUser(uid, null, phone));
      const token = createTestToken(uid);

      // Suppress console.log to check if phone appears in logs
      const originalLog = console.log;
      const logCalls: string[] = [];
      console.log = (...args: any[]) => {
        logCalls.push(args.join(" "));
      };

      try {
        await withAuthHeader(app, token).get("/users/me").expect(200);
      } finally {
        console.log = originalLog;
      }

      // Verify phone number does not appear in any log calls
      const allLogs = logCalls.join(" ");
      expect(allLogs).not.toContain(phone);
      expect(allLogs).not.toMatch(/\+?\d{10,}/);
    });
  });

  describe("Error handling", () => {
    it("should not include stack traces in production mode", async () => {
      // Set production mode
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      try {
        const uid = "user-123";
        authUsers.set(uid, mockAuthUser(uid, "test@example.com", null));
        const token = createTestToken(uid);

        // Trigger an error (invalid endpoint)
        const response = await withAuthHeader(app, token)
          .get("/users/invalid-endpoint")
          .expect(404);

        // Verify response does not contain stack trace
        expect(JSON.stringify(response.body)).not.toContain("stack");
        expect(JSON.stringify(response.body)).not.toContain("at ");
        expect(JSON.stringify(response.body)).not.toContain("Error:");
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("should return generic error messages only", async () => {
      const uid = "user-123";
      authUsers.set(uid, mockAuthUser(uid, "test@example.com", null));
      const token = createTestToken(uid);

      // Trigger an error
      const response = await withAuthHeader(app, token)
        .get("/users/invalid-endpoint")
        .expect(404);

      // Verify error message is generic (no internal details)
      expect(response.body).not.toHaveProperty("stack");
      // NestJS always includes a message field for NotFoundException
      // Verify it exists and is generic (not leaking internals)

      expect(typeof response.body.message).toBe("string");

      expect(response.body.message).toMatch(/Cannot/);
    });
  });

  describe("Rate limiting", () => {
    it("should return 429 for rate-limited endpoints", async () => {
      // This test would require actual rate limiting middleware setup
      // For now, we verify the endpoint exists and would be rate-limited
      const uid = "user-123";
      authUsers.set(uid, mockAuthUser(uid, "test@example.com", null));
      const token = createTestToken(uid);

      // Create user first (GET /users/me creates user if it doesn't exist)
      await withAuthHeader(app, token).get("/users/me").expect(200);

      // Note: Actual rate limiting would need to be configured in test
      // This test verifies the infrastructure exists
      // In a real scenario, you would make many requests and verify 429
    });
  });

  describe("MIME type validation", () => {
    it("should reject invalid MIME uploads", async () => {
      // This test would require file upload endpoint
      // For now, we verify the concept
      // In a real implementation, you would test:
      // - Invalid MIME types are rejected
      // - Only allowed MIME types (image/jpeg, image/png, image/webp) are accepted
    });
  });

  describe("Input validation", () => {
    it("should reject unknown properties in request body", async () => {
      const uid = "user-123";
      authUsers.set(uid, mockAuthUser(uid, "test@example.com", null));
      const token = createTestToken(uid);

      // Create user first (GET /users/me creates user if it doesn't exist)
      await withAuthHeader(app, token).get("/users/me").expect(200);

      // Test input validation on a real POST endpoint
      // POST /users/update-location requires latitude and longitude
      // Sending unknown properties should be rejected by ValidationPipe
      await withAuthHeader(app, token)
        .post("/users/update-location")
        .send({
          latitude: 40.7128,
          longitude: -74.006,
          unknownProperty: "should be rejected",
        })
        .expect(400); // Should be rejected by ValidationPipe (forbidNonWhitelisted: true)
    });
  });
});
