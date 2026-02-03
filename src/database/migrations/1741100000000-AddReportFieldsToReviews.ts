import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReportFieldsToReviews1741100000000 implements MigrationInterface {
  name = "AddReportFieldsToReviews1741100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isSQLite = queryRunner.connection.driver.options.type === "sqlite";

    // Add reportCategory column
    await queryRunner.query(`
      ALTER TABLE "reviews"
      ADD COLUMN "reportCategory" varchar NULL
    `);

    // Add photos column - handle SQLite vs PostgreSQL differently
    if (isSQLite) {
      // SQLite: Store arrays as JSON text (nullable first, then set default)
      await queryRunner.query(`
        ALTER TABLE "reviews"
        ADD COLUMN "photos" text
      `);
      // Set default value for existing rows
      await queryRunner.query(`
        UPDATE "reviews"
        SET "photos" = '[]'
        WHERE "photos" IS NULL
      `);
      // SQLite doesn't support adding NOT NULL with DEFAULT in ALTER TABLE
      // TypeORM will handle the NOT NULL constraint via entity definition
    } else {
      // PostgreSQL: Use native array type
      await queryRunner.query(`
        ALTER TABLE "reviews"
        ADD COLUMN "photos" text[] NOT NULL DEFAULT '{}'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reviews"
      DROP COLUMN IF EXISTS "photos",
      DROP COLUMN IF EXISTS "reportCategory"
    `);
  }
}
