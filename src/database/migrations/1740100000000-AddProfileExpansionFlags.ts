import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProfileExpansionFlags1740100000000 implements MigrationInterface {
  name = "AddProfileExpansionFlags1740100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Per-dimension expansion flags to allow relaxing filters when queues are empty
    await queryRunner.query(`
      ALTER TABLE "profiles"
      ADD COLUMN "expandAge" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles"
      ADD COLUMN "expandDistance" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles"
      ADD COLUMN "expandHeight" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "profiles"
      DROP COLUMN IF EXISTS "expandHeight"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles"
      DROP COLUMN IF EXISTS "expandDistance"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles"
      DROP COLUMN IF EXISTS "expandAge"
    `);
  }
}
