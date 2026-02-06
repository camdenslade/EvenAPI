import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReports1736500000000 implements MigrationInterface {
  name = "CreateReports1736500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create reports table for user and content reporting
    // Reports persist indefinitely and are not deleted when users are deleted
    // No foreign keys to user tables (users may be deleted, but reports must persist)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reporterUid" varchar NOT NULL,
        "targetUid" varchar NULL,
        "contentId" varchar NULL,
        "contentType" varchar NOT NULL,
        "reason" text NULL,
        "status" varchar NOT NULL DEFAULT 'pending',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reports" PRIMARY KEY ("id")
      )
    `);

    // Create indexes for efficient lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reports_reporter" ON "reports" ("reporterUid")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reports_target" ON "reports" ("targetUid")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reports_content" ON "reports" ("contentType", "contentId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reports_status" ON "reports" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "reports"`);
  }
}
