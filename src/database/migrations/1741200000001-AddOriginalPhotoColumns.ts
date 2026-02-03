import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOriginalPhotoColumns1741200000001 implements MigrationInterface {
  name = "AddOriginalPhotoColumns1741200000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isSQLite = queryRunner.connection.driver.options.type === "sqlite";

    // profiles.photoOriginals
    if (isSQLite) {
      await queryRunner.query(`
        ALTER TABLE "profiles"
        ADD COLUMN "photoOriginals" text
      `);
      await queryRunner.query(`
        UPDATE "profiles"
        SET "photoOriginals" = "photos"
        WHERE "photoOriginals" IS NULL
      `);
    } else {
      await queryRunner.query(`
        ALTER TABLE "profiles"
        ADD COLUMN "photoOriginals" text[] NOT NULL DEFAULT '{}'
      `);
      await queryRunner.query(`
        UPDATE "profiles"
        SET "photoOriginals" = "photos"
      `);
    }

    // profile_photos columns
    await queryRunner.query(`
      ALTER TABLE "profile_photos"
      ADD COLUMN "originalKey" text NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "profile_photos"
      ADD COLUMN "derivedKey" text NULL
    `);
    if (isSQLite) {
      await queryRunner.query(`
        ALTER TABLE "profile_photos"
        ADD COLUMN "crop" text NULL
      `);
    } else {
      await queryRunner.query(`
        ALTER TABLE "profile_photos"
        ADD COLUMN "crop" jsonb NULL
      `);
    }

    // Backfill originalKey/derivedKey to mirror url
    await queryRunner.query(`
      UPDATE "profile_photos"
      SET "originalKey" = "url",
          "derivedKey" = "url"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "profiles"
      DROP COLUMN IF EXISTS "photoOriginals"
    `);
    await queryRunner.query(`
      ALTER TABLE "profile_photos"
      DROP COLUMN IF EXISTS "originalKey",
      DROP COLUMN IF EXISTS "derivedKey",
      DROP COLUMN IF EXISTS "crop"
    `);
  }
}
