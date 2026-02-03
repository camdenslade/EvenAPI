import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserThemePresets1769000000000 implements MigrationInterface {
  name = "AddUserThemePresets1769000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "themePresets" ${
        process.env.NODE_ENV === "test" ? "text" : "jsonb"
      }`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "themePresets"`);
  }
}
