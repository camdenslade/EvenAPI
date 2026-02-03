import { MigrationInterface, QueryRunner } from "typeorm";

export class DropUserRoleColumn1740600000000 implements MigrationInterface {
  name = "DropUserRoleColumn1740600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "role"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "role" character varying NOT NULL DEFAULT 'user'
    `);
  }
}
