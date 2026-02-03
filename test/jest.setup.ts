// Global test setup file
// This file runs before all tests

// Mock environment variables
process.env.NODE_ENV = "test";
process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_NAME = process.env.DB_NAME || "evenapp_test";
process.env.DB_USER = process.env.DB_USER || "postgres";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "testpassword";
process.env.AWS_REGION = "us-east-1";
process.env.SECRETS_PREFIX = "even/test";
process.env.PHONE_HASH_SALT = "test-salt-for-hashing";
process.env.PHONE_HASH_HMAC_SECRET =
  process.env.PHONE_HASH_HMAC_SECRET || "test-hmac-secret";
process.env.AWS_S3_BUCKET = "test-bucket";
process.env.COGNITO_APP_CLIENT_ID =
  process.env.COGNITO_APP_CLIENT_ID || "test-cognito-client";

// Suppress console logs during tests (optional, can be removed if you want to see logs)
// Uncomment if you want to suppress logs:
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };
