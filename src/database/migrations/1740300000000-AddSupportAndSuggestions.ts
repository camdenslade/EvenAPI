import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class AddSupportAndSuggestions1740300000000 implements MigrationInterface {
  name = "AddSupportAndSuggestions1740300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "support_tickets",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          { name: "name", type: "varchar" },
          { name: "email", type: "varchar" },
          { name: "category", type: "varchar" },
          { name: "priority", type: "varchar" },
          { name: "subject", type: "varchar" },
          { name: "description", type: "text" },
          { name: "status", type: "varchar", default: "'open'" },
          {
            name: "createdAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "suggestions",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          { name: "name", type: "varchar" },
          { name: "email", type: "varchar" },
          { name: "category", type: "varchar" },
          { name: "subject", type: "varchar" },
          { name: "suggestion", type: "text" },
          { name: "status", type: "varchar", default: "'new'" },
          {
            name: "createdAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("suggestions");
    await queryRunner.dropTable("support_tickets");
  }
}
