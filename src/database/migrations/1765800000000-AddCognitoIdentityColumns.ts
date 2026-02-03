import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCognitoIdentityColumns1765800000000 implements MigrationInterface {
  name = "AddCognitoIdentityColumns1765800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "cognitoSub" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "appleSub" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "phoneHashDet" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "phoneE164Encrypted" text`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_cognitoSub" UNIQUE ("cognitoSub")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_appleSub" UNIQUE ("appleSub")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_phoneHashDet" UNIQUE ("phoneHashDet")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_users_phoneHashDet"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_users_appleSub"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_users_cognitoSub"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "phoneE164Encrypted"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phoneHashDet"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "appleSub"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "cognitoSub"`);
  }
}
