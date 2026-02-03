import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProfileSchoolFields1740900000000 implements MigrationInterface {
  name = "AddProfileSchoolFields1740900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD COLUMN "school" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD COLUMN "gradYear" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD COLUMN "major" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "major"`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "gradYear"`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "school"`);
  }
}
