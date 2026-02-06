import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDiscoveryFilterPreferences1736800000000 implements MigrationInterface {
  name = "AddDiscoveryFilterPreferences1736800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add discovery filter preference columns to profiles table
    // These are separate from personal details and represent what users want to filter by

    // Height preference filters (min/max in inches)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefMinHeight" integer NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefMaxHeight" integer NULL
    `);

    // Race preference filter (array of race strings)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefRace" text[] NULL
    `);

    // Religion preference filter (array of religion strings)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefReligion" text[] NULL
    `);

    // Politics preference filter (array of politics strings)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefPolitics" text[] NULL
    `);

    // Education preference filter (array of education strings)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefEducation" text[] NULL
    `);

    // Activity level preference filter (single string)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefActivityLevel" varchar NULL
    `);

    // Drinking preference filter (array of drinking strings)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefDrinking" text[] NULL
    `);

    // Smoking preference filter (array of smoking strings)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefSmoking" text[] NULL
    `);

    // Marijuana preference filter (array of marijuana strings)
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      ADD COLUMN IF NOT EXISTS "prefMarijuana" text[] NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove all discovery filter preference columns
    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefMarijuana"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefSmoking"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefDrinking"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefActivityLevel"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefEducation"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefPolitics"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefReligion"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefRace"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefMaxHeight"
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles" 
      DROP COLUMN IF EXISTS "prefMinHeight"
    `);
  }
}
