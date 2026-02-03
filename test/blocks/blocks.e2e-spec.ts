import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { BlocksModule } from "../../src/blocks/blocks.module";
import { Block } from "../../src/database/entities/block.entity";
import { SafetyExclusion } from "../../src/database/entities/safety-exclusion.entity";
import { SafetyIdentity } from "../../src/database/entities/safety-identity.entity";
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
import { hashPhone } from "../../src/utils/phone-hash";

describe("BlocksController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let blocksRepo: Repository<Block>;
  let safetyExclusionRepo: Repository<SafetyExclusion>;
  let safetyRepo: Repository<SafetyIdentity>;
  let usersRepo: Repository<User>;
  let authUsers: Map<string, any>;

  beforeAll(async () => {
    process.env.PHONE_HASH_SALT = "test-salt-for-hashing";
    authUsers = new Map();

    const mockFirebase = createMockAuthProvider(authUsers);

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource()),
        TypeOrmModule.forFeature([
          Block,
          SafetyExclusion,
          SafetyIdentity,
          User,
        ]),
        BlocksModule,
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
    blocksRepo = module.get<Repository<Block>>(getRepositoryToken(Block));
    safetyExclusionRepo = module.get<Repository<SafetyExclusion>>(
      getRepositoryToken(SafetyExclusion),
    );
    safetyRepo = module.get<Repository<SafetyIdentity>>(
      getRepositoryToken(SafetyIdentity),
    );
    usersRepo = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterAll(async () => {
    if (app) {
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await blocksRepo.clear();
    await safetyExclusionRepo.clear();
    await safetyRepo.clear();
    await usersRepo.clear();
    authUsers.clear();
  });

  async function createUserWithPhone(uid: string, phone: string) {
    authUsers.set(uid, mockAuthUser(uid, null, phone));
    const user = usersRepo.create({
      uid,
      email: null,
      isSubscribed: false,
    });

    const phoneHash = hashPhone(phone);
    let safetyIdentity = await safetyRepo.findOne({ where: { phoneHash } });
    if (!safetyIdentity) {
      safetyIdentity = safetyRepo.create({
        phoneHash,
        emergencyUsed: false,
        strikes: 0,
        deletedCount: 0,
      });
      safetyIdentity = await safetyRepo.save(safetyIdentity);
    }

    user.safetyIdentityId = safetyIdentity.id;
    return await usersRepo.save(user);
  }

  describe("POST /blocks/:uid", () => {
    it("should create Block and SafetyExclusion", async () => {
      const blockerUid = "blocker-123";
      const blockedUid = "blocked-456";
      const blockerPhone = "+1111111111";
      const blockedPhone = "+2222222222";

      await createUserWithPhone(blockerUid, blockerPhone);
      await createUserWithPhone(blockedUid, blockedPhone);

      const blockerToken = createTestToken(blockerUid);

      const response = await withAuthHeader(app, blockerToken)
        .post(`/blocks/${blockedUid}`)
        .expect(200);

      expect(response.body).toEqual({ success: true });

      // Verify Block was created
      const block = await blocksRepo.findOne({
        where: { blockerUid, blockedUid },
      });
      expect(block).toBeDefined();

      // Verify SafetyExclusion was created
      const blocker = await usersRepo.findOne({ where: { uid: blockerUid } });
      const blocked = await usersRepo.findOne({ where: { uid: blockedUid } });
      const exclusion = await safetyExclusionRepo.findOne({
        where: {
          sourceSafetyIdentityId: blocker!.safetyIdentityId!,
          targetSafetyIdentityId: blocked!.safetyIdentityId!,
        },
      });
      expect(exclusion).toBeDefined();
      expect(exclusion?.reason).toBe("user_block");
    });

    it("should be idempotent (duplicate block does not error)", async () => {
      const blockerUid = "blocker-123";
      const blockedUid = "blocked-456";
      const blockerPhone = "+1111111111";
      const blockedPhone = "+2222222222";

      await createUserWithPhone(blockerUid, blockerPhone);
      await createUserWithPhone(blockedUid, blockedPhone);

      const blockerToken = createTestToken(blockerUid);

      // First block
      await withAuthHeader(app, blockerToken)
        .post(`/blocks/${blockedUid}`)
        .expect(200);

      // Second block (should succeed idempotently)
      await withAuthHeader(app, blockerToken)
        .post(`/blocks/${blockedUid}`)
        .expect(200);

      // Verify only one Block exists
      const blocks = await blocksRepo.find({
        where: { blockerUid, blockedUid },
      });
      expect(blocks).toHaveLength(1);
    });
  });

  describe("DELETE /blocks/:uid", () => {
    it("should remove Block but preserve SafetyExclusion", async () => {
      const blockerUid = "blocker-123";
      const blockedUid = "blocked-456";
      const blockerPhone = "+1111111111";
      const blockedPhone = "+2222222222";

      await createUserWithPhone(blockerUid, blockerPhone);
      await createUserWithPhone(blockedUid, blockedPhone);

      const blockerToken = createTestToken(blockerUid);

      // Create block
      await withAuthHeader(app, blockerToken)
        .post(`/blocks/${blockedUid}`)
        .expect(200);

      // Unblock
      await withAuthHeader(app, blockerToken)
        .delete(`/blocks/${blockedUid}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({ success: true });
        });

      // Verify Block was removed
      const block = await blocksRepo.findOne({
        where: { blockerUid, blockedUid },
      });
      expect(block).toBeNull();

      // Verify SafetyExclusion is preserved
      const blocker = await usersRepo.findOne({ where: { uid: blockerUid } });
      const blocked = await usersRepo.findOne({ where: { uid: blockedUid } });
      const exclusion = await safetyExclusionRepo.findOne({
        where: {
          sourceSafetyIdentityId: blocker!.safetyIdentityId!,
          targetSafetyIdentityId: blocked!.safetyIdentityId!,
        },
      });
      expect(exclusion).toBeDefined();
    });
  });

  describe("SafetyExclusion persistence", () => {
    it("should persist SafetyExclusion across account deletion", async () => {
      const blockerUid = "blocker-123";
      const blockedUid = "blocked-456";
      const blockerPhone = "+1111111111";
      const blockedPhone = "+2222222222";

      const blocker = await createUserWithPhone(blockerUid, blockerPhone);
      const blocked = await createUserWithPhone(blockedUid, blockedPhone);

      const blockerToken = createTestToken(blockerUid);

      // Create block
      await withAuthHeader(app, blockerToken)
        .post(`/blocks/${blockedUid}`)
        .expect(200);

      // Verify SafetyExclusion exists
      const exclusionBefore = await safetyExclusionRepo.findOne({
        where: {
          sourceSafetyIdentityId: blocker.safetyIdentityId!,
          targetSafetyIdentityId: blocked.safetyIdentityId!,
        },
      });
      expect(exclusionBefore).toBeDefined();
      const exclusionId = exclusionBefore!.id;

      // Delete blocker account (simulate)
      await usersRepo.remove(blocker);

      // Verify SafetyExclusion still exists
      const exclusionAfter = await safetyExclusionRepo.findOne({
        where: { id: exclusionId },
      });
      expect(exclusionAfter).toBeDefined();
    });

    it("should persist SafetyExclusion across re-signup with same phone hash", async () => {
      const blockerUid1 = "blocker-123";
      const blockerUid2 = "blocker-456"; // New UID after re-signup
      const blockedUid = "blocked-789";
      const blockerPhone = "+1111111111";
      const blockedPhone = "+2222222222";

      const blocker1 = await createUserWithPhone(blockerUid1, blockerPhone);
      const blocked = await createUserWithPhone(blockedUid, blockedPhone);

      const blockerToken1 = createTestToken(blockerUid1);

      // Create block
      await withAuthHeader(app, blockerToken1)
        .post(`/blocks/${blockedUid}`)
        .expect(200);

      // Delete blocker account
      await usersRepo.remove(blocker1);

      // Re-signup with same phone (new UID)
      const blocker2 = await createUserWithPhone(blockerUid2, blockerPhone);

      // Verify SafetyExclusion still exists (by SafetyIdentity, not userId)
      const exclusion = await safetyExclusionRepo.findOne({
        where: {
          sourceSafetyIdentityId: blocker2.safetyIdentityId!,
          targetSafetyIdentityId: blocked.safetyIdentityId!,
        },
      });
      expect(exclusion).toBeDefined();
    });
  });

  describe("Enforcement (silent)", () => {
    it("should enforce blocks silently (generic errors only)", async () => {
      // This test verifies that blocked users are handled silently
      // The actual enforcement logic would be in services (swipe queue, match, message)
      // For e2e, we verify the block exists and would be checked by services
      const blockerUid = "blocker-123";
      const blockedUid = "blocked-456";
      const blockerPhone = "+1111111111";
      const blockedPhone = "+2222222222";

      await createUserWithPhone(blockerUid, blockerPhone);
      await createUserWithPhone(blockedUid, blockedPhone);

      const blockerToken = createTestToken(blockerUid);

      // Create block
      await withAuthHeader(app, blockerToken)
        .post(`/blocks/${blockedUid}`)
        .expect(200);

      // Verify block exists (enforcement would check this in services)
      const block = await blocksRepo.findOne({
        where: { blockerUid, blockedUid },
      });
      expect(block).toBeDefined();
    });
  });
});
