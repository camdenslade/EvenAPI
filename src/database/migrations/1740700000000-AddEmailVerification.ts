import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailVerification1740700000000 implements MigrationInterface {
  name = "AddEmailVerification1740700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "email_verifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userUid" character varying NOT NULL,
        "email" character varying NOT NULL,
        "code" character varying NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_verifications" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_email_verifications_userUid_email" ON "email_verifications" ("userUid", "email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_email_verifications_userUid_email"`,
    );
    await queryRunner.query(`DROP TABLE "email_verifications"`);
  }
}
