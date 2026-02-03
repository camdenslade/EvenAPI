import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNotificationsEnabledToUsers1740000000000 implements MigrationInterface {
  name = "AddNotificationsEnabledToUsers1740000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "notificationsEnabled" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "notificationsEnabled"`,
    );
  }
}
