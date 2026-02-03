import { MigrationInterface, QueryRunner } from "typeorm";

export class RemovePhoneFromUsers1736300000000 implements MigrationInterface {
  name = "RemovePhoneFromUsers1736300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the phone column from users table
    // Phone numbers are now only stored as hashes in safety_identities table
    await queryRunner.query(`
      ALTER TABLE "users" 
      DROP COLUMN IF EXISTS "phone"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add phone column (nullable, as some users may not have phone)
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN "phone" varchar NULL
    `);
  }
}
