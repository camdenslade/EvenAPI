import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeHeightRaceRequired1736200000000 implements MigrationInterface {
  name = "MakeHeightRaceRequired1736200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backfill existing profiles with default values if null or empty
    // Set a placeholder value that users will need to update
    await queryRunner.query(`
      UPDATE "profiles" 
      SET "height" = ARRAY['Not specified']::text[]
      WHERE "height" IS NULL OR array_length("height", 1) IS NULL
    `);

    await queryRunner.query(`
      UPDATE "profiles" 
      SET "race" = ARRAY['Not specified']::text[]
      WHERE "race" IS NULL OR array_length("race", 1) IS NULL
    `);

    // Make height NOT NULL
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ALTER COLUMN "height" SET NOT NULL
    `);

    // Make race NOT NULL
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ALTER COLUMN "race" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to nullable
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ALTER COLUMN "race" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ALTER COLUMN "height" DROP NOT NULL
    `);
  }
}
