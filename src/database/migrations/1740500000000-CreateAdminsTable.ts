import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAdminsTable1740500000000 implements MigrationInterface {
  name = "CreateAdminsTable1740500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admins" (
        "id" SERIAL PRIMARY KEY,
        "uid" varchar(255) UNIQUE NOT NULL,
        "email" varchar(255) UNIQUE NOT NULL,
        "created_at" TIMESTAMP DEFAULT NOW(),
        "created_by_uid" varchar(255),
        CONSTRAINT "fk_admin_created_by" FOREIGN KEY ("created_by_uid") REFERENCES "admins" ("uid") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_admins_uid" ON "admins" ("uid")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_admins_email" ON "admins" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admins"`);
  }
}
