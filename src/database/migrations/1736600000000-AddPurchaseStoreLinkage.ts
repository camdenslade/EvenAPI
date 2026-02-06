import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPurchaseStoreLinkage1736600000000 implements MigrationInterface {
  name = "AddPurchaseStoreLinkage1736600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add store-scoped purchase linkage for restoration across account deletion
    // Purchases are soft-deleted (deletedAt) on account deletion, not hard-deleted
    // This allows restoration when user re-signs up with same store account

    // Add store column (apple | google)
    await queryRunner.query(`
      ALTER TABLE "purchases" 
      ADD COLUMN IF NOT EXISTS "store" varchar NOT NULL DEFAULT 'apple'
    `);

    // Add storePurchaseIdentifier column (stable store-scoped identifier)
    // Apple: original_transaction_id
    // Google: purchaseToken or obfuscatedAccountId
    await queryRunner.query(`
      ALTER TABLE "purchases" 
      ADD COLUMN IF NOT EXISTS "storePurchaseIdentifier" varchar NULL
    `);

    // Add deletedAt column for soft deletion
    await queryRunner.query(`
      ALTER TABLE "purchases" 
      ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz NULL
    `);

    // Backfill store based on platform
    await queryRunner.query(`
      UPDATE "purchases" 
      SET "store" = CASE 
        WHEN "platform" = 'ios' THEN 'apple'
        WHEN "platform" = 'android' THEN 'google'
        ELSE 'apple'
      END
    `);

    // Backfill storePurchaseIdentifier from originalTransactionId for Apple purchases
    // For existing Apple purchases, use originalTransactionId if available
    await queryRunner.query(`
      UPDATE "purchases" 
      SET "storePurchaseIdentifier" = "originalTransactionId"
      WHERE "store" = 'apple' 
        AND "originalTransactionId" IS NOT NULL
        AND "storePurchaseIdentifier" IS NULL
    `);

    // Create index for efficient restoration lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchases_store_identifier" 
      ON "purchases" ("store", "storePurchaseIdentifier")
    `);

    // Remove default after backfill
    await queryRunner.query(`
      ALTER TABLE "purchases" 
      ALTER COLUMN "store" DROP DEFAULT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_purchases_store_identifier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" DROP COLUMN IF EXISTS "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" DROP COLUMN IF EXISTS "storePurchaseIdentifier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "purchases" DROP COLUMN IF EXISTS "store"`,
    );
  }
}
