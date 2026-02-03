import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PurchasesModule } from "../../src/purchases/purchases.module";
import { Purchase } from "../../src/database/entities/purchase.entity";
import { User } from "../../src/database/entities/user.entity";
import { createTestApp, closeTestApp } from "../helpers/app";
import { createTestToken, withAuthHeader } from "../helpers/auth";
import { createMockAuthProvider, mockAuthUser } from "../helpers/auth.mock";
import { mockSecretsService } from "../helpers/secrets.mock";
import { mockS3Service } from "../helpers/s3.mock";
import { SecretsService } from "../../src/secrets/secrets.service";
import { S3Service } from "../../src/s3/s3.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { createTestDataSource } from "../helpers/db";

describe("PurchasesController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let purchasesRepo: Repository<Purchase>;
  let usersRepo: Repository<User>;
  let authUsers: Map<string, any>;

  beforeAll(async () => {
    authUsers = new Map();

    const mockFirebase = createMockAuthProvider(authUsers);

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource()),
        TypeOrmModule.forFeature([Purchase, User]),
        PurchasesModule,
      ],
      providers: [
        {
          provide: "FIREBASE_ADMIN",
          useValue: mockFirebase,
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
      .overrideProvider(S3Service)
      .useValue(mockS3Service)
      .overrideProvider(SecretsService)
      .useValue(mockSecretsService)
      .compile();

    app = await createTestApp(module);
    purchasesRepo = module.get<Repository<Purchase>>(
      getRepositoryToken(Purchase),
    );
    usersRepo = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterAll(async () => {
    if (app) {
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await purchasesRepo.clear();
    await usersRepo.clear();
    authUsers.clear();
  });

  async function createUser(uid: string, email: string | null = null) {
    authUsers.set(uid, mockAuthUser(uid, email, null));
    const user = usersRepo.create({
      uid,
      email,
      isSubscribed: false,
    });
    return await usersRepo.save(user);
  }

  function createAppleReceipt(
    transactionId: string,
    productId: string,
    originalTransactionId?: string,
  ): string {
    return JSON.stringify({
      transactionId,
      productId,
      originalTransactionId: originalTransactionId || transactionId,
    });
  }

  function createGoogleReceipt(
    orderId: string,
    productId: string,
    purchaseToken?: string,
  ): string {
    return JSON.stringify({
      orderId,
      productId,
      purchaseToken: purchaseToken || `token-${orderId}`,
    });
  }

  describe("POST /purchases/verify", () => {
    it("should verify purchase and save with store linkage", async () => {
      const uid = "user-123";
      const user = await createUser(uid, "user@example.com");
      const token = createTestToken(uid);

      const receipt = createAppleReceipt("txn-123", "subscription.monthly");

      const response = await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body).toHaveProperty("store", "apple");
      expect(response.body).toHaveProperty("storePurchaseIdentifier");
      expect(response.body).toHaveProperty("transactionId", "txn-123");
      expect(response.body).toHaveProperty("status", "verified");

      // Verify purchase in database

      const purchaseId = response.body.id;

      const purchase = await purchasesRepo.findOne({
        where: { id: purchaseId },
      });
      expect(purchase).toBeDefined();

      expect(purchase?.userId).toBe(user.id);
      expect(purchase?.store).toBe("apple");
    });

    it("should prevent duplicate purchases", async () => {
      const uid = "user-123";
      await createUser(uid, "user@example.com");
      const token = createTestToken(uid);

      const receipt = createAppleReceipt("txn-123", "subscription.monthly");

      // First purchase
      await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      // Duplicate purchase (should return existing)
      await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      // Verify only one purchase exists
      const purchases = await purchasesRepo.find({
        where: { transactionId: "txn-123", platform: "ios" },
      });
      expect(purchases).toHaveLength(1);
    });

    it("should save Google Play purchases with store linkage", async () => {
      const uid = "user-123";
      await createUser(uid, "user@example.com");
      const token = createTestToken(uid);

      const receipt = createGoogleReceipt("order-456", "consumable.undo");

      const response = await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "android",
          receipt,
        })
        .expect(201);

      expect(response.body).toHaveProperty("store", "google");
      expect(response.body).toHaveProperty("storePurchaseIdentifier");
    });
  });

  describe("Account deletion - soft delete", () => {
    it("should soft-delete purchases on account deletion", async () => {
      const uid = "user-123";
      const user = await createUser(uid, "user@example.com");
      const token = createTestToken(uid);

      const receipt = createAppleReceipt("txn-123", "subscription.monthly");

      // Create purchase
      const createResponse = await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      const purchaseId = createResponse.body.id;

      // Delete user account (simulate)

      await usersRepo.remove(user);

      // Verify purchase is soft-deleted

      const purchase = await purchasesRepo.findOne({
        where: { id: purchaseId },
      });
      expect(purchase).toBeDefined();
      expect(purchase?.deletedAt).not.toBeNull();
    });
  });

  describe("POST /purchases/restore", () => {
    it("should restore purchases after re-signup", async () => {
      const uid1 = "user-123";
      const uid2 = "user-456"; // New UID after re-signup
      const user1 = await createUser(uid1, "user@example.com");
      const token1 = createTestToken(uid1);

      const originalTransactionId = "orig-txn-789";
      const receipt = createAppleReceipt(
        "txn-123",
        "subscription.monthly",
        originalTransactionId,
      );

      // Create purchase with first user
      await withAuthHeader(app, token1)
        .post("/purchases/verify")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      // Delete first user
      await usersRepo.remove(user1);

      // Re-signup with new UID
      const user2 = await createUser(uid2, "user@example.com");
      const token2 = createTestToken(uid2);

      // Restore purchases
      const response = await withAuthHeader(app, token2)
        .post("/purchases/restore")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      expect(Array.isArray(response.body)).toBe(true);

      expect(response.body.length).toBeGreaterThan(0);

      // Verify purchase is reassigned to new user
      const purchase = await purchasesRepo.findOne({
        where: { storePurchaseIdentifier: originalTransactionId },
      });
      expect(purchase).toBeDefined();
      expect(purchase?.userId).toBe(user2.id);
      expect(purchase?.deletedAt).toBeNull();
    });

    it("should restore entitlements", async () => {
      const uid = "user-123";
      await createUser(uid, "user@example.com");
      const token = createTestToken(uid);

      const receipt = createAppleReceipt("txn-123", "subscription.monthly");

      // Create purchase
      await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      // Restore (should be idempotent)
      const response = await withAuthHeader(app, token)
        .post("/purchases/restore")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      expect(Array.isArray(response.body)).toBe(true);

      expect(response.body.length).toBeGreaterThan(0);
    });

    it("should be idempotent (multiple restores)", async () => {
      const uid = "user-123";
      await createUser(uid, "user@example.com");
      const token = createTestToken(uid);

      const receipt = createAppleReceipt("txn-123", "subscription.monthly");

      // Create purchase
      await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      // Multiple restores should all succeed
      await withAuthHeader(app, token)
        .post("/purchases/restore")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);

      await withAuthHeader(app, token)
        .post("/purchases/restore")
        .send({
          platform: "ios",
          receipt,
        })
        .expect(201);
    });
  });

  describe("Purchase verification", () => {
    it("should validate Apple receipt format", async () => {
      const uid = "user-123";
      await createUser(uid, "user@example.com");
      const token = createTestToken(uid);

      const invalidReceipt = JSON.stringify({ invalid: "data" });

      await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "ios",
          receipt: invalidReceipt,
        })
        .expect(400);
    });

    it("should validate Google receipt format", async () => {
      const uid = "user-123";
      await createUser(uid, "user@example.com");
      const token = createTestToken(uid);

      const invalidReceipt = JSON.stringify({ invalid: "data" });

      await withAuthHeader(app, token)
        .post("/purchases/verify")
        .send({
          platform: "android",
          receipt: invalidReceipt,
        })
        .expect(400);
    });
  });
});
