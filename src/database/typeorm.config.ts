//********************************************************************
//
// TypeORM configuration helpers
//
// Synchronous configuration builder.
// Assumes secrets are already loaded into process.env
// (via preload-secrets.ts, PM2 env, or local .env).
//
//********************************************************************

import { DataSource, DataSourceOptions } from "typeorm";

export function getTypeOrmConfigSync(): DataSourceOptions {
  if (
    !process.env.POSTGRES_HOST ||
    !process.env.POSTGRES_USER ||
    !process.env.POSTGRES_PASSWORD ||
    !process.env.POSTGRES_DB
  ) {
    throw new Error(
      "Database env vars missing before TypeORM init. " +
        "Ensure preload-secrets.ts ran successfully.",
    );
  }

  return {
    type: "postgres",
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,

    synchronize: false,
    logging: true,

    entities: [__dirname + "/../**/*.entity.{ts,js}"],
    migrations: [__dirname + "/migrations/*.{ts,js}"],
  };
}

export function createTypeOrmDataSource(): DataSource {
  return new DataSource(getTypeOrmConfigSync());
}
