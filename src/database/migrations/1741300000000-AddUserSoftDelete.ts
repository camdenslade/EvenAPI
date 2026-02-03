import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserSoftDelete1741300000000 implements MigrationInterface {
  name = "AddUserSoftDelete1741300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "deletedAt" ${process.env.NODE_ENV === "test" ? "datetime" : "timestamptz"}`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "deletedReason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD COLUMN "deletedAt" ${process.env.NODE_ENV === "test" ? "datetime" : "timestamptz"}`,
    );

    await queryRunner.query(
      `ALTER TABLE "token_ledger" DROP CONSTRAINT IF EXISTS "FK_token_ledger_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_ledger" ALTER COLUMN "userId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_ledger"
       ADD CONSTRAINT "FK_token_ledger_user"
       FOREIGN KEY ("userId")
       REFERENCES "users"("id")
       ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "token_ledger" DROP CONSTRAINT "FK_token_ledger_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_ledger" ALTER COLUMN "userId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "token_ledger"
       ADD CONSTRAINT "FK_token_ledger_user"
       FOREIGN KEY ("userId")
       REFERENCES "users"("id")
       ON DELETE CASCADE`,
    );

    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "deletedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedReason"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
  }
}
