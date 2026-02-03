import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuditEvents1739900000000 implements MigrationInterface {
  name = "CreateAuditEvents1739900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event" character varying NOT NULL,
        "payload" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_events_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_events"`);
  }
}
