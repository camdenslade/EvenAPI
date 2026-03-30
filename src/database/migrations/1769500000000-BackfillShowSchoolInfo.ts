import { MigrationInterface, QueryRunner } from "typeorm";

export class BackfillShowSchoolInfo1769500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "profiles" SET "showSchoolInfo" = true WHERE school IS NOT NULL AND ("showSchoolInfo" = false OR "showSchoolInfo" IS NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op: cannot distinguish backfilled rows from explicitly set ones
  }
}
