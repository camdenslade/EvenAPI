import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProfilePhotos1736900000000 implements MigrationInterface {
  name = "CreateProfilePhotos1736900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "profile_photos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" varchar NOT NULL,
        "url" text NOT NULL,
        "status" varchar NOT NULL DEFAULT 'pending',
        "reason" text NULL,
        "confidence" float NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_profile_photos" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_profile_photos_userId_status" ON "profile_photos" ("userId", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_profile_photos_status_createdAt" ON "profile_photos" ("status", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_profile_photos_status_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_profile_photos_userId_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_photos"`);
  }
}
