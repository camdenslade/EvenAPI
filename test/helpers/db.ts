// Database helper functions for tests
import { DataSourceOptions } from "typeorm";
import * as path from "path";

/**
 * Creates a test database configuration using SQLite in-memory database
 * This is faster than PostgreSQL for unit tests
 *
 * Note: SQLite doesn't support timestamptz, so TypeORM will automatically
 * map it to datetime during synchronize. No migrations are run in tests.
 */
export function createTestDataSource(): DataSourceOptions {
  return {
    type: "sqlite",
    database: ":memory:",
    synchronize: true, // Auto-sync schema for tests (maps timestamptz -> datetime)
    logging: false, // Disable logging in tests
    dropSchema: true, // Drop schema before each test
    migrations: [], // No migrations in tests
    entities: [
      path.join(__dirname, "../../src/database/entities/*.entity.{ts,js}"),
    ],
    // SQLite-specific: TypeORM will automatically map timestamptz to datetime
    // during synchronize, so no explicit mapping needed
  };
}

/**
 * Cleans up test database
 * Note: For SQLite in-memory databases, cleanup happens automatically
 * when the connection is closed. This function is provided for consistency.
 */
export async function cleanupTestDb(): Promise<void> {
  // SQLite in-memory databases are automatically cleaned up
  // when the connection is closed, so no explicit cleanup needed
}
