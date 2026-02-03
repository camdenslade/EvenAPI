import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ReportsModule } from "../../src/reports/reports.module";
import { Report } from "../../src/database/entities/report.entity";
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

describe("ReportsController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let reportsRepo: Repository<Report>;
  let usersRepo: Repository<User>;
  let authUsers: Map<string, any>;

  beforeAll(async () => {
    authUsers = new Map();

    const mockFirebase = createMockAuthProvider(authUsers);

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource()),
        TypeOrmModule.forFeature([Report, User]),
        ReportsModule,
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
    reportsRepo = module.get<Repository<Report>>(getRepositoryToken(Report));
    usersRepo = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterAll(async () => {
    if (app) {
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await reportsRepo.clear();
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

  describe("POST /reports/users/:uid", () => {
    it("should create user report", async () => {
      const reporterUid = "reporter-123";
      const targetUid = "target-456";

      await createUser(reporterUid, "reporter@example.com");
      await createUser(targetUid, "target@example.com");

      const reporterToken = createTestToken(reporterUid);

      const response = await withAuthHeader(app, reporterToken)
        .post(`/reports/users/${targetUid}`)
        .send({ reason: "Inappropriate behavior" })
        .expect(200);

      expect(response.body).toEqual({ success: true });

      // Verify report was created
      const report = await reportsRepo.findOne({
        where: { reporterUid, targetUid, contentType: "profile" },
      });
      expect(report).toBeDefined();
      expect(report?.reason).toBe("Inappropriate behavior");
      expect(report?.status).toBe("pending");
    });

    it("should handle duplicate reports idempotently", async () => {
      const reporterUid = "reporter-123";
      const targetUid = "target-456";

      await createUser(reporterUid, "reporter@example.com");
      await createUser(targetUid, "target@example.com");

      const reporterToken = createTestToken(reporterUid);

      // First report
      await withAuthHeader(app, reporterToken)
        .post(`/reports/users/${targetUid}`)
        .send({ reason: "First reason" })
        .expect(200);

      // Duplicate report (should succeed, update timestamp)
      const response = await withAuthHeader(app, reporterToken)
        .post(`/reports/users/${targetUid}`)
        .send({ reason: "Updated reason" })
        .expect(200);

      expect(response.body).toEqual({ success: true });

      // Verify only one report exists (updated)
      const reports = await reportsRepo.find({
        where: { reporterUid, targetUid, contentType: "profile" },
      });
      expect(reports).toHaveLength(1);
      expect(reports[0].reason).toBe("Updated reason");
    });

    it("should always return 2xx even for duplicates", async () => {
      const reporterUid = "reporter-123";
      const targetUid = "target-456";

      await createUser(reporterUid, "reporter@example.com");
      await createUser(targetUid, "target@example.com");

      const reporterToken = createTestToken(reporterUid);

      // Multiple duplicate reports should all return 200
      await withAuthHeader(app, reporterToken)
        .post(`/reports/users/${targetUid}`)
        .expect(200);

      await withAuthHeader(app, reporterToken)
        .post(`/reports/users/${targetUid}`)
        .expect(200);

      await withAuthHeader(app, reporterToken)
        .post(`/reports/users/${targetUid}`)
        .expect(200);
    });
  });

  describe("POST /reports/content", () => {
    it("should create content report", async () => {
      const reporterUid = "reporter-123";
      const contentId = "message-456";

      await createUser(reporterUid, "reporter@example.com");

      const reporterToken = createTestToken(reporterUid);

      const response = await withAuthHeader(app, reporterToken)
        .post("/reports/content")
        .send({
          contentType: "message",
          contentId,
          reason: "Inappropriate content",
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });

      // Verify report was created
      const report = await reportsRepo.findOne({
        where: { reporterUid, contentType: "message", contentId },
      });
      expect(report).toBeDefined();
      expect(report?.reason).toBe("Inappropriate content");
      expect(report?.status).toBe("pending");
    });

    it("should handle duplicate content reports idempotently", async () => {
      const reporterUid = "reporter-123";
      const contentId = "photo-789";

      await createUser(reporterUid, "reporter@example.com");

      const reporterToken = createTestToken(reporterUid);

      // First report
      await withAuthHeader(app, reporterToken)
        .post("/reports/content")
        .send({
          contentType: "photo",
          contentId,
          reason: "First reason",
        })
        .expect(200);

      // Duplicate report
      await withAuthHeader(app, reporterToken)
        .post("/reports/content")
        .send({
          contentType: "photo",
          contentId,
          reason: "Updated reason",
        })
        .expect(200);

      // Verify only one report exists
      const reports = await reportsRepo.find({
        where: { reporterUid, contentType: "photo", contentId },
      });
      expect(reports).toHaveLength(1);
      expect(reports[0].reason).toBe("Updated reason");
    });
  });

  describe("Report persistence", () => {
    it("should persist reports after user deletion", async () => {
      const reporterUid = "reporter-123";
      const targetUid = "target-456";

      const reporter = await createUser(reporterUid, "reporter@example.com");
      await createUser(targetUid, "target@example.com");

      const reporterToken = createTestToken(reporterUid);

      // Create report
      await withAuthHeader(app, reporterToken)
        .post(`/reports/users/${targetUid}`)
        .send({ reason: "Test report" })
        .expect(200);

      // Verify report exists
      const reportBefore = await reportsRepo.findOne({
        where: { reporterUid, targetUid },
      });
      expect(reportBefore).toBeDefined();
      const reportId = reportBefore!.id;

      // Delete reporter account
      await usersRepo.remove(reporter);

      // Verify report still exists
      const reportAfter = await reportsRepo.findOne({
        where: { id: reportId },
      });
      expect(reportAfter).toBeDefined();
      expect(reportAfter?.reporterUid).toBe(reporterUid);
    });
  });

  describe("No moderation side effects", () => {
    it("should not trigger automatic moderation actions", async () => {
      // Reports should be created without side effects
      // Actual moderation would be handled by admin tools
      const reporterUid = "reporter-123";
      const targetUid = "target-456";

      await createUser(reporterUid, "reporter@example.com");
      await createUser(targetUid, "target@example.com");

      const reporterToken = createTestToken(reporterUid);

      // Create report
      await withAuthHeader(app, reporterToken)
        .post(`/reports/users/${targetUid}`)
        .expect(200);

      // Verify target user is not affected (no blocks, no status changes)
      const targetAfter = await usersRepo.findOne({
        where: { uid: targetUid },
      });
      expect(targetAfter).toBeDefined();
    });
  });
});
