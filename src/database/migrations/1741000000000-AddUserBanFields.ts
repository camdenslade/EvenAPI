import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserBanFields1741000000000 implements MigrationInterface {
  name = "AddUserBanFields1741000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "banned" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "bannedAt" ${process.env.NODE_ENV === "test" ? "datetime" : "timestamptz"}`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "banReason" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "banReason"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "bannedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "banned"`);
  }
}
