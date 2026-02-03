import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSafetyExclusions1736400000000 implements MigrationInterface {
  name = "CreateSafetyExclusions1736400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create safety_exclusions table for persistent safety enforcement
    // SafetyExclusion persists across account deletion by design - it is
    // internal-only and prevents users from interacting even after re-signup
    //
    // CRITICAL: Foreign keys use ON DELETE RESTRICT (NOT CASCADE) to prevent
    // accidental deletion of SafetyExclusion records. SafetyIdentity records
    // are never deleted automatically - they persist for fraud prevention.
    // If a SafetyIdentity must be deleted (admin action), SafetyExclusion
    // records must be handled explicitly first.
    await queryRunner.query(`
      CREATE TABLE "safety_exclusions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sourceSafetyIdentityId" uuid NOT NULL,
        "targetSafetyIdentityId" uuid NOT NULL,
        "reason" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_safety_exclusions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_safety_exclusions_source" FOREIGN KEY ("sourceSafetyIdentityId") 
          REFERENCES "safety_identities"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_safety_exclusions_target" FOREIGN KEY ("targetSafetyIdentityId") 
          REFERENCES "safety_identities"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_safety_exclusions_unique" UNIQUE ("sourceSafetyIdentityId", "targetSafetyIdentityId")
      )
    `);

    // Create index for efficient lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_safety_exclusions_source" ON "safety_exclusions" ("sourceSafetyIdentityId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_safety_exclusions_target" ON "safety_exclusions" ("targetSafetyIdentityId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_exclusions"`);
  }
}
