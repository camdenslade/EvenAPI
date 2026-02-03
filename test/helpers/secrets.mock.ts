// Mock SecretsService for tests
// Never let tests touch AWS Secrets Manager or real secrets

import { SecretsService } from "../../src/secrets/secrets.service";

export const mockSecretsService: Partial<SecretsService> = {
  getSecret: jest.fn().mockResolvedValue("test-secret-value"),
  getSecretSync: jest.fn().mockReturnValue("test-secret-value"),
};
