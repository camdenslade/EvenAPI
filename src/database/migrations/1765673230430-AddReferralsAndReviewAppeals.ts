import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReferralsAndReviewAppeals1765673230430
  implements MigrationInterface
{
  name = "AddReferralsAndReviewAppeals1765673230430";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "referrals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "referrerUserId" character varying NOT NULL,
        "referredEmail" character varying NOT NULL,
        "referredUserId" character varying,
        "status" character varying NOT NULL DEFAULT 'pending',
        "referrerRewarded" boolean NOT NULL DEFAULT false,
        "referredRewarded" boolean NOT NULL DEFAULT false,
        "minutesActive" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_referrals_referredEmail" UNIQUE ("referredEmail"),
        CONSTRAINT "PK_referrals" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_referrals_referrerUserId" ON "referrals" ("referrerUserId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_referrals_referredUserId" ON "referrals" ("referredUserId")
    `);

    await queryRunner.query(`
      CREATE TABLE "review_appeals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reviewId" character varying NOT NULL,
        "appellantUserId" character varying NOT NULL,
        "text" text,
        "photoUrls" text[] NOT NULL DEFAULT '{}',
        "status" character varying NOT NULL DEFAULT 'pending',
        "adminNote" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_appeals" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_review_appeals_reviewId" ON "review_appeals" ("reviewId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_review_appeals_appellantUserId" ON "review_appeals" ("appellantUserId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_review_appeals_status" ON "review_appeals" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_review_appeals_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_review_appeals_appellantUserId"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_review_appeals_reviewId"`,
    );
    await queryRunner.query(`DROP TABLE "review_appeals"`);

    await queryRunner.query(
      `DROP INDEX "IDX_referrals_referredUserId"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_referrals_referrerUserId"`,
    );
    await queryRunner.query(`DROP TABLE "referrals"`);
  }
}
