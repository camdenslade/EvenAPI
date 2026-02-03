// Application helper functions for tests
import { INestApplication } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";

/**
 * Creates a test NestJS application
 * Configures the same global settings as production (ValidationPipe)
 * Note: API prefix is NOT set in tests to match existing test expectations
 */
export async function createTestApp(
  module: TestingModule,
): Promise<INestApplication> {
  const app = module.createNestApplication();

  // Apply global validation pipe (same as production)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}

/**
 * Closes a test application
 */
export async function closeTestApp(
  app: INestApplication | undefined,
): Promise<void> {
  if (app) {
    await app.close();
  }
}
