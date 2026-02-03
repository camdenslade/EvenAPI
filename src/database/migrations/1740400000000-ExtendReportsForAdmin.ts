import { MigrationInterface, QueryRunner } from "typeorm";

export class ExtendReportsForAdmin1740400000000 implements MigrationInterface {
  name = "ExtendReportsForAdmin1740400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reports"
      ADD COLUMN "assignedTo" varchar NULL,
      ADD COLUMN "notes" text NULL,
      ADD COLUMN "evidence" jsonb NULL,
      ADD COLUMN "resolvedAt" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reports"
      DROP COLUMN IF EXISTS "resolvedAt",
      DROP COLUMN IF EXISTS "evidence",
      DROP COLUMN IF EXISTS "notes",
      DROP COLUMN IF EXISTS "assignedTo"
    `);
  }
}
