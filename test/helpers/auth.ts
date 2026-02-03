// Authentication helper functions for tests
import { INestApplication } from "@nestjs/common";
import request, { Test } from "supertest";

/**
 * Creates a request builder with authorization header
 * Returns an object with HTTP methods (get, post, put, delete) that include the auth token
 */
export function withAuthHeader(app: INestApplication, token: string) {
  return {
    get: (url: string): Test =>
      request(app.getHttpServer())
        .get(url)
        .set("Authorization", `Bearer ${token}`),

    post: (url: string): Test =>
      request(app.getHttpServer())
        .post(url)
        .set("Authorization", `Bearer ${token}`),

    put: (url: string): Test =>
      request(app.getHttpServer())
        .put(url)
        .set("Authorization", `Bearer ${token}`),

    delete: (url: string): Test =>
      request(app.getHttpServer())
        .delete(url)
        .set("Authorization", `Bearer ${token}`),
  };
}

/**
 * Creates a test Firebase token (simple format for mocking)
 */
export function createTestToken(uid: string, revoked = false): string {
  return revoked ? `token-${uid}-revoked` : `token-${uid}`;
}
