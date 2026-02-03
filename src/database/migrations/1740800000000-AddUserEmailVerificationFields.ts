import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserEmailVerificationFields1740800000000 implements MigrationInterface {
  name = "AddUserEmailVerificationFields1740800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "schoolEmailVerified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "schoolEmailVerifiedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "schoolEmailVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "schoolEmailVerified"`,
    );
  }
}
