//********************************************************************
//
// RedisService Unit Tests
//
// Tests Redis client initialization with authentication password.
// Ensures REDIS_PASSWORD is always passed to createClient() and
// validates fail-fast behavior when password is missing.
//
//*******************************************************************

import { Test, TestingModule } from "@nestjs/testing";
import { RedisService } from "../../src/redis/redis.service";
import { SecretsService } from "../../src/secrets/secrets.service";
import { createClient } from "redis";

// Mock redis module
jest.mock("redis", () => ({
  createClient: jest.fn(),
}));

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

describe("RedisService", () => {
  let service: RedisService;
  let secretsService: jest.Mocked<SecretsService>;
  let mockRedisClient: any;
  let getSecretSyncMock: jest.MockedFunction<
    (key: string) => string | undefined
  >;
  let getSecretMock: jest.MockedFunction<
    (secretName: string, envVarName: string) => Promise<string>
  >;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Redis client
    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      lPush: jest.fn(),
      rPop: jest.fn(),
    };

    mockCreateClient.mockReturnValue(mockRedisClient);

    // Create mock functions
    getSecretSyncMock = jest.fn();
    getSecretMock = jest.fn();

    // Mock SecretsService
    secretsService = {
      getSecretSync: getSecretSyncMock,
      getSecret: getSecretMock,
    } as any;
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.onModuleDestroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("onModuleInit - Authentication", () => {
    it("should pass password to createClient when using REDIS_HOST/REDIS_PORT", async () => {
      // Arrange
      getSecretSyncMock
        .mockReturnValueOnce("redis-host.example.com") // REDIS_HOST
        .mockReturnValueOnce("6379") // REDIS_PORT
        .mockReturnValueOnce("my-redis-password"); // REDIS_PASSWORD

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: SecretsService,
            useValue: secretsService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);

      // Act
      await service.onModuleInit();

      // Assert
      expect(getSecretSyncMock).toHaveBeenNthCalledWith(1, "REDIS_HOST");
      expect(getSecretSyncMock).toHaveBeenNthCalledWith(2, "REDIS_PORT");
      expect(getSecretSyncMock).toHaveBeenNthCalledWith(3, "REDIS_PASSWORD");

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "redis://redis-host.example.com:6379",
          password: "my-redis-password",
        }),
      );

      expect(mockRedisClient.connect).toHaveBeenCalled();
    });

    it("should pass password to createClient when using REDIS_URL", async () => {
      // Arrange
      // Call order in service: REDIS_HOST, REDIS_PORT, REDIS_URL (async), REDIS_PASSWORD
      getSecretSyncMock
        .mockReturnValueOnce(undefined) // First: REDIS_HOST (undefined triggers REDIS_URL path)
        .mockReturnValueOnce("6379") // Second: REDIS_PORT (always called, even if REDIS_HOST is undefined)
        .mockReturnValueOnce("my-redis-password"); // Third: REDIS_PASSWORD (after REDIS_URL)
      // getSecret is called for REDIS_URL (between REDIS_PORT and REDIS_PASSWORD)
      getSecretMock.mockResolvedValue("redis://redis.example.com:6379");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: SecretsService,
            useValue: secretsService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);

      // Act
      await service.onModuleInit();

      // Assert
      expect(getSecretMock).toHaveBeenCalledWith("redis-url", "REDIS_URL");
      // Note: getSecretSync is called after getSecret for REDIS_PASSWORD
      expect(
        getSecretSyncMock.mock.calls.some(
          (call) => call[0] === "REDIS_PASSWORD",
        ),
      ).toBe(true);

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "redis://redis.example.com:6379",
          password: "my-redis-password",
        }),
      );

      expect(mockRedisClient.connect).toHaveBeenCalled();
    });

    it("should throw error if REDIS_PASSWORD is missing", async () => {
      // Arrange
      getSecretSyncMock
        .mockReturnValueOnce("redis-host.example.com") // REDIS_HOST
        .mockReturnValueOnce("6379") // REDIS_PORT
        .mockReturnValueOnce(undefined); // REDIS_PASSWORD missing

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: SecretsService,
            useValue: secretsService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);

      // Act & Assert
      await expect(service.onModuleInit()).rejects.toThrow(
        "REDIS_PASSWORD is required but not found",
      );

      // Redis client should not be created
      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(mockRedisClient.connect).not.toHaveBeenCalled();
    });

    it("should throw error if REDIS_PASSWORD is empty string", async () => {
      // Arrange
      getSecretSyncMock
        .mockReturnValueOnce("redis-host.example.com") // REDIS_HOST
        .mockReturnValueOnce("6379") // REDIS_PORT
        .mockReturnValueOnce(""); // REDIS_PASSWORD empty

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: SecretsService,
            useValue: secretsService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);

      // Act & Assert
      await expect(service.onModuleInit()).rejects.toThrow(
        "REDIS_PASSWORD is required but not found",
      );

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("should throw error if REDIS_PASSWORD is whitespace only", async () => {
      // Arrange
      getSecretSyncMock
        .mockReturnValueOnce("redis-host.example.com") // REDIS_HOST
        .mockReturnValueOnce("6379") // REDIS_PORT
        .mockReturnValueOnce("   "); // REDIS_PASSWORD whitespace only

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: SecretsService,
            useValue: secretsService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);

      // Act & Assert
      await expect(service.onModuleInit()).rejects.toThrow(
        "REDIS_PASSWORD is required but not found",
      );

      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("should NOT rely on URL-only authentication when password is provided separately", async () => {
      // Arrange - URL has no embedded password, but REDIS_PASSWORD exists
      getSecretSyncMock
        .mockReturnValueOnce("redis-host.example.com") // REDIS_HOST
        .mockReturnValueOnce("6379") // REDIS_PORT
        .mockReturnValueOnce("separate-password"); // REDIS_PASSWORD

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: SecretsService,
            useValue: secretsService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);

      // Act
      await service.onModuleInit();

      // Assert - password is passed explicitly, not in URL
      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "redis://redis-host.example.com:6379", // No password in URL
          password: "separate-password", // Password passed explicitly
        }),
      );
    });

    it("should use default port 6379 when REDIS_PORT is not provided", async () => {
      // Arrange
      getSecretSyncMock
        .mockReturnValueOnce("redis-host.example.com") // REDIS_HOST
        .mockReturnValueOnce(undefined) // REDIS_PORT (should default to 6379)
        .mockReturnValueOnce("my-redis-password"); // REDIS_PASSWORD

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: SecretsService,
            useValue: secretsService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);

      // Act
      await service.onModuleInit();

      // Assert
      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "redis://redis-host.example.com:6379", // Default port used
          password: "my-redis-password",
        }),
      );
    });
  });

  describe("Regression Protection", () => {
    it("should enforce that password is always passed explicitly (not in URL only)", async () => {
      // This test ensures we never regress to URL-only authentication
      getSecretSyncMock
        .mockReturnValueOnce("redis-host.example.com")
        .mockReturnValueOnce("6379")
        .mockReturnValueOnce("explicit-password");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: SecretsService,
            useValue: secretsService,
          },
        ],
      }).compile();

      service = module.get<RedisService>(RedisService);

      await service.onModuleInit();

      // Verify password is in createClient options, not just in URL
      const createClientCall = mockCreateClient.mock.calls[0][0] as any;
      expect(createClientCall).toHaveProperty("password");
      expect(createClientCall.password).toBe("explicit-password");
      expect(createClientCall.url).not.toContain("password"); // URL should not contain password
    });
  });
});
