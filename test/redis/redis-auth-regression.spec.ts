//********************************************************************
//
// Redis Authentication Regression Test
//
// Integration test ensuring that app bootstrap fails if Redis password
// is missing or unused. This prevents validation and usage from drifting
// apart again.
//
//*******************************************************************

import { Test, TestingModule } from "@nestjs/testing";
import { RedisService } from "../../src/redis/redis.service";
import { RedisModule } from "../../src/redis/redis.module";
import { SecretsService } from "../../src/secrets/secrets.service";
import { SecretsModule } from "../../src/secrets/secrets.module";
import { ConfigModule } from "@nestjs/config";
import * as redis from "redis";

describe("Redis Authentication Regression", () => {
  describe("Bootstrap Safety - Password Validation", () => {
    it("should fail app bootstrap if REDIS_PASSWORD is missing", async () => {
      // Arrange - Mock SecretsService that returns missing password
      const mockSecretsService = {
        getSecretSync: jest.fn((key: string) => {
          if (key === "REDIS_HOST") return "redis.example.com";
          if (key === "REDIS_PORT") return "6379";
          if (key === "REDIS_PASSWORD") return undefined; // Missing password
          return undefined;
        }),
        getSecret: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          SecretsModule,
          RedisModule,
        ],
      })
        .overrideProvider(SecretsService)
        .useValue(mockSecretsService)
        .compile();

      const service = module.get<RedisService>(RedisService);

      // Act & Assert - Bootstrap should fail with clear error
      await expect(service.onModuleInit()).rejects.toThrow(
        "REDIS_PASSWORD is required but not found",
      );
    });

    it("should fail app bootstrap if REDIS_PASSWORD is empty string", async () => {
      // Arrange
      const mockSecretsService = {
        getSecretSync: jest.fn((key: string) => {
          if (key === "REDIS_HOST") return "redis.example.com";
          if (key === "REDIS_PORT") return "6379";
          if (key === "REDIS_PASSWORD") return ""; // Empty password
          return undefined;
        }),
        getSecret: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          SecretsModule,
          RedisModule,
        ],
      })
        .overrideProvider(SecretsService)
        .useValue(mockSecretsService)
        .compile();

      const service = module.get<RedisService>(RedisService);

      // Act & Assert
      await expect(service.onModuleInit()).rejects.toThrow(
        "REDIS_PASSWORD is required but not found",
      );
    });

    it("should succeed bootstrap when REDIS_PASSWORD is provided", async () => {
      // Arrange - Mock createClient to prevent actual Redis connection
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        quit: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        incr: jest.fn(),
      };

      jest.doMock("redis", () => ({
        createClient: jest.fn().mockReturnValue(mockRedisClient),
      }));

      const mockSecretsService = {
        getSecretSync: jest.fn((key: string) => {
          if (key === "REDIS_HOST") return "redis.example.com";
          if (key === "REDIS_PORT") return "6379";
          if (key === "REDIS_PASSWORD") return "valid-password";
          return undefined;
        }),
        getSecret: jest.fn(),
      };

      // Mock redis.createClient
      jest.spyOn(redis, "createClient").mockReturnValue(mockRedisClient as any);

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          SecretsModule,
          RedisModule,
        ],
      })
        .overrideProvider(SecretsService)
        .useValue(mockSecretsService)
        .compile();

      const service = module.get<RedisService>(RedisService);

      // Act - Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();

      // Cleanup
      await service.onModuleDestroy();
    });
  });

  describe("Consistency Check - Validation and Usage", () => {
    it("should ensure that if main.ts requires REDIS_PASSWORD, RedisService must consume it", async () => {
      // This test documents the invariant:
      // main.ts validates REDIS_PASSWORD exists
      // RedisService must use it (not just validate it exists)

      // Arrange - Password exists (as validated by main.ts)
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        quit: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        incr: jest.fn(),
      };

      const createClientSpy = jest
        .spyOn(redis, "createClient")
        .mockReturnValue(mockRedisClient as any);

      const providedPassword = "test-password-from-env";
      const mockSecretsService = {
        getSecretSync: jest.fn((key: string) => {
          if (key === "REDIS_HOST") return "redis.example.com";
          if (key === "REDIS_PORT") return "6379";
          if (key === "REDIS_PASSWORD") return providedPassword;
          return undefined;
        }),
        getSecret: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          SecretsModule,
          RedisModule,
        ],
      })
        .overrideProvider(SecretsService)
        .useValue(mockSecretsService)
        .compile();

      const service = module.get<RedisService>(RedisService);

      // Act
      await service.onModuleInit();

      // Assert - Password must be passed to createClient
      // Check that at least one call includes the provided password
      const callsWithPassword = createClientSpy.mock.calls.filter(
        (call) => call[0]?.password === providedPassword,
      );
      expect(callsWithPassword.length).toBeGreaterThan(0);

      // Verify password is in the options (not just in URL)
      const lastCall =
        createClientSpy.mock.calls[createClientSpy.mock.calls.length - 1]?.[0];
      expect(lastCall).toHaveProperty("password", providedPassword);
      expect(lastCall?.url).toBe("redis://redis.example.com:6379");

      // Cleanup
      await service.onModuleDestroy();
      createClientSpy.mockRestore();
    });

    it("should fail if password validation exists but password is not used", async () => {
      // This regression test ensures we never validate password but forget to use it
      // The test verifies that createClient is called with password parameter

      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        quit: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        incr: jest.fn(),
      };

      const createClientSpy = jest
        .spyOn(redis, "createClient")
        .mockReturnValue(mockRedisClient as any);

      const mockSecretsService = {
        getSecretSync: jest.fn((key: string) => {
          if (key === "REDIS_HOST") return "redis.example.com";
          if (key === "REDIS_PORT") return "6379";
          if (key === "REDIS_PASSWORD") return "test-password";
          return undefined;
        }),
        getSecret: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          SecretsModule,
          RedisModule,
        ],
      })
        .overrideProvider(SecretsService)
        .useValue(mockSecretsService)
        .compile();

      const service = module.get<RedisService>(RedisService);

      await service.onModuleInit();

      // Assert - createClient MUST have password in options
      expect(createClientSpy).toHaveBeenCalled();

      // Find the call with the test password (may not be the first call)
      const callWithTestPassword = createClientSpy.mock.calls.find(
        (call) => call[0]?.password === "test-password",
      );
      expect(callWithTestPassword).toBeDefined();

      const createClientCall = callWithTestPassword?.[0];
      expect(createClientCall).toBeDefined();
      expect(createClientCall).toHaveProperty("password");
      expect(createClientCall?.password).toBe("test-password");

      // This test would fail if we regressed to URL-only authentication
      expect(createClientCall?.url).not.toContain("test-password");

      // Cleanup
      await service.onModuleDestroy();
      createClientSpy.mockRestore();
    });
  });
});
