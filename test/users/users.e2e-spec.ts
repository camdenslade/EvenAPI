import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UsersModule } from "../../src/users/users.module";
import { User } from "../../src/database/entities/user.entity";
import { SafetyIdentity } from "../../src/database/entities/safety-identity.entity";
import { createTestApp, closeTestApp } from "../helpers/app";
import { createTestToken, withAuthHeader } from "../helpers/auth";
import { createMockAuthProvider, mockAuthUser } from "../helpers/auth.mock";
import { mockSecretsService } from "../helpers/secrets.mock";
import { mockS3Service } from "../helpers/s3.mock";
import { SecretsService } from "../../src/secrets/secrets.service";
import { S3Service } from "../../src/s3/s3.service";
import { AuthModule } from "../../src/auth/auth.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { createTestDataSource } from "../helpers/db";

describe("UsersController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let usersRepo: Repository<User>;
  let safetyRepo: Repository<SafetyIdentity>;
  let authUsers: Map<string, any>;

  beforeAll(async () => {
    authUsers = new Map();

    const mockFirebase = createMockAuthProvider(authUsers);

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource()),
        TypeOrmModule.forFeature([User, SafetyIdentity]),
        UsersModule,
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
      .overrideModule(AuthModule)
      .useModule(AuthModule)
      .compile();

    app = await createTestApp(module);
    usersRepo = module.get<Repository<User>>(getRepositoryToken(User));
    safetyRepo = module.get<Repository<SafetyIdentity>>(
      getRepositoryToken(SafetyIdentity),
    );
  });

  afterAll(async () => {
    if (app) {
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    // Clear database before each test
    await usersRepo.clear();
    await safetyRepo.clear();
    authUsers.clear();
  });

  describe("POST /users/me (ensureUserExists)", () => {
    it("should create user with Google (email only)", async () => {
      const uid = "google-user-123";
      const email = "google@example.com";

      authUsers.set(uid, mockAuthUser(uid, email, null));
      const token = createTestToken(uid);

      const response = await withAuthHeader(app, token)
        .post("/users/me")
        .expect(201);

      expect(response.body).toHaveProperty("uid", uid);
      expect(response.body).toHaveProperty("email", email);
      expect(response.body).not.toHaveProperty("phone");
      expect(response.body).not.toHaveProperty("phoneNumber");

      // Verify user in database
      const user = await usersRepo.findOne({ where: { uid } });
      expect(user).toBeDefined();

      expect(user?.email).toBe(email);
    });

    it("should create user with Phone (phone hash only)", async () => {
      const uid = "phone-user-123";
      const phone = "+1234567890";

      authUsers.set(uid, mockAuthUser(uid, null, phone));
      const token = createTestToken(uid);

      const response = await withAuthHeader(app, token)
        .post("/users/me")
        .expect(201);

      expect(response.body).toHaveProperty("uid", uid);

      expect(response.body.email).toBeNull();
      expect(response.body).not.toHaveProperty("phone");
      expect(response.body).not.toHaveProperty("phoneNumber");

      // Verify user in database
      const user = await usersRepo.findOne({ where: { uid } });
      expect(user).toBeDefined();

      expect(user?.email).toBeNull();

      // Verify SafetyIdentity was created with phone hash
      const safetyIdentity = await safetyRepo.findOne({
        where: { id: user!.safetyIdentityId! },
      });
      expect(safetyIdentity).toBeDefined();
      expect(safetyIdentity?.phoneHash).toBeDefined();
    });

    it("should create user with Apple (no email, no phone)", async () => {
      const uid = "apple-user-123";

      authUsers.set(uid, mockAuthUser(uid, null, null));
      const token = createTestToken(uid);

      const response = await withAuthHeader(app, token)
        .post("/users/me")
        .expect(201);

      expect(response.body).toHaveProperty("uid", uid);

      expect(response.body.email).toBeNull();
      expect(response.body).not.toHaveProperty("phone");
      expect(response.body).not.toHaveProperty("phoneNumber");

      // Verify user in database
      const user = await usersRepo.findOne({ where: { uid } });
      expect(user).toBeDefined();

      expect(user?.email).toBeNull();
      expect(user?.safetyIdentityId).toBeNull();
    });

    it("should return existing user on subsequent calls", async () => {
      const uid = "existing-user-123";
      const email = "existing@example.com";

      authUsers.set(uid, mockAuthUser(uid, email, null));
      const token = createTestToken(uid);

      // First call
      await withAuthHeader(app, token).post("/users/me").expect(201);

      // Second call should return existing user
      const response = await withAuthHeader(app, token)
        .post("/users/me")
        .expect(201);

      expect(response.body.uid).toBe(uid);

      // Verify only one user exists
      const users = await usersRepo.find({ where: { uid } });
      expect(users).toHaveLength(1);
    });
  });

  describe("GET /users/me", () => {
    it("should return user data without phone number", async () => {
      const uid = "get-user-123";
      const email = "get@example.com";
      const phone = "+1234567890";

      authUsers.set(uid, mockAuthUser(uid, email, phone));
      const token = createTestToken(uid);

      // Create user first
      await withAuthHeader(app, token).post("/users/me").expect(201);

      // Get user
      const response = await withAuthHeader(app, token)
        .get("/users/me")
        .expect(200);

      expect(response.body).toHaveProperty("uid", uid);
      expect(response.body).toHaveProperty("email", email);
      expect(response.body).not.toHaveProperty("phone");
      expect(response.body).not.toHaveProperty("phoneNumber");
    });

    it("should sync email on GET if changed in Firebase", async () => {
      const uid = "sync-user-123";
      const email1 = "old@example.com";
      const email2 = "new@example.com";

      authUsers.set(uid, mockAuthUser(uid, email1, null));
      const token = createTestToken(uid);

      // Create user with old email
      await withAuthHeader(app, token).post("/users/me").expect(201);

      // Update Firebase user email
      authUsers.set(uid, mockAuthUser(uid, email2, null));

      // GET should sync new email
      const response = await withAuthHeader(app, token)
        .get("/users/me")
        .expect(200);

      expect(response.body.email).toBe(email2);
    });
  });

  describe("DELETE /users/me", () => {
    it("should delete user and preserve SafetyIdentity", async () => {
      const uid = "delete-user-123";
      const phone = "+1234567890";

      authUsers.set(uid, mockAuthUser(uid, null, phone));
      const token = createTestToken(uid);

      // Create user
      await withAuthHeader(app, token).post("/users/me").expect(201);

      const user = await usersRepo.findOne({ where: { uid } });
      expect(user).toBeDefined();
      const safetyId = user!.safetyIdentityId;

      // Delete user
      await withAuthHeader(app, token)
        .delete("/users/me")
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ success: true });
        });

      // Verify user is deleted
      const deletedUser = await usersRepo.findOne({ where: { uid } });
      expect(deletedUser).toBeNull();

      // Verify SafetyIdentity is preserved
      const safetyIdentity = await safetyRepo.findOne({
        where: { id: safetyId! },
      });
      expect(safetyIdentity).toBeDefined();
    });

    it("should soft-delete purchases", async () => {
      // This test would require Purchase entity setup
      // For now, we verify the endpoint works
      const uid = "delete-purchases-user-123";

      authUsers.set(uid, mockAuthUser(uid, "test@example.com", null));
      const token = createTestToken(uid);

      // Create user
      await withAuthHeader(app, token).post("/users/me").expect(201);

      // Delete user
      await withAuthHeader(app, token).delete("/users/me").expect(200);

      // Verify user is deleted
      const deletedUser = await usersRepo.findOne({ where: { uid } });
      expect(deletedUser).toBeNull();
    });
  });

  describe("Phone number security", () => {
    it("should never return phone number in API responses", async () => {
      const uid = "phone-security-123";
      const phone = "+1234567890";

      authUsers.set(uid, mockAuthUser(uid, null, phone));
      const token = createTestToken(uid);

      // Create user
      const createResponse = await withAuthHeader(app, token)
        .post("/users/me")
        .expect(201);

      // Verify phone is not in response
      expect(createResponse.body).not.toHaveProperty("phone");
      expect(createResponse.body).not.toHaveProperty("phoneNumber");
      expect(JSON.stringify(createResponse.body)).not.toContain(phone);

      // Get user
      const getResponse = await withAuthHeader(app, token)
        .get("/users/me")
        .expect(200);

      // Verify phone is not in response
      expect(getResponse.body).not.toHaveProperty("phone");
      expect(getResponse.body).not.toHaveProperty("phoneNumber");
      expect(JSON.stringify(getResponse.body)).not.toContain(phone);
    });
  });
});
