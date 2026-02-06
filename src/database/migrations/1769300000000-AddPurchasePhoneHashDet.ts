//********************************************************************
//
// AddPurchasePhoneHashDet Migration
//
// Adds phoneHashDet column to purchases table to enable purchase
// restoration by phone number. This allows users who sign up with
// the same phone number but a different Apple ID to restore their
// previous purchases.
//
//********************************************************************

import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";

export class AddPurchasePhoneHashDet1769300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add phoneHashDet column
    await queryRunner.addColumn(
      "purchases",
      new TableColumn({
        name: "phoneHashDet",
        type: "varchar",
        isNullable: true,
      }),
    );

    // Create index for efficient phone hash lookups
    await queryRunner.createIndex(
      "purchases",
      new TableIndex({
        name: "IDX_purchases_phoneHashDet",
        columnNames: ["phoneHashDet"],
      }),
    );

    // Backfill phoneHashDet from users table for existing purchases
    await queryRunner.query(`
      UPDATE purchases p
      SET "phoneHashDet" = u."phoneHashDet"
      FROM users u
      WHERE p."userId" = u.id
        AND u."phoneHashDet" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.dropIndex("purchases", "IDX_purchases_phoneHashDet");

    // Drop column
    await queryRunner.dropColumn("purchases", "phoneHashDet");
  }
}
