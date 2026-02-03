import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateVerifiedSchoolEmails1769200000000 implements MigrationInterface {
  name = "CreateVerifiedSchoolEmails1769200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "verified_school_emails" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "firstVerifiedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastVerifiedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastVerifiedByUid" character varying,
        CONSTRAINT "PK_verified_school_emails_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_verified_school_emails_email" UNIQUE ("email")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "verified_school_emails"`);
  }
}
