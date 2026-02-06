import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrefMinDistanceMiles1736700000000 implements MigrationInterface {
  name = "AddPrefMinDistanceMiles1736700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add prefMinDistanceMiles column with default value of 1
    // This allows users to set a minimum distance preference for discovery
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefMinDistanceMiles" integer NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the prefMinDistanceMiles column
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefMinDistanceMiles"
    `);
  }
}
