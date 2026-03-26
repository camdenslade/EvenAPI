import { MigrationInterface, QueryRunner } from "typeorm";

export class AddShowSchoolInfo1769400000000 implements MigrationInterface {
  name = "AddShowSchoolInfo1769400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "showSchoolInfo" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profiles" DROP COLUMN "showSchoolInfo"`,
    );
  }
}
