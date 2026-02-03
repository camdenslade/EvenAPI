// typeorm/preload-secrets.ts
import "dotenv/config";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const SECRET_ID = process.env.SECRET_ID || "even/alpha/app-env";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

const sab = new SharedArrayBuffer(4);
const ia = new Int32Array(sab);

let preloadError: Error | undefined;

void (async (): Promise<void> => {
  try {
    if (process.env.POSTGRES_PASSWORD) {
      return;
    }

    const client = new SecretsManagerClient({ region: AWS_REGION });
    const resp = await client.send(
      new GetSecretValueCommand({ SecretId: SECRET_ID }),
    );

    if (!resp.SecretString) {
      throw new Error("Secrets Manager returned empty secret");
    }

    const parsed = JSON.parse(resp.SecretString) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Invalid secret format: expected JSON object");
    }

    const kvEntries = Object.entries(parsed as Record<string, unknown>);
    for (const [k, v] of kvEntries) {
      if (process.env[k] === undefined && typeof v === "string") {
        process.env[k] = v;
      }
    }

    if (!process.env.POSTGRES_PASSWORD) {
      throw new Error("POSTGRES_PASSWORD missing after preload");
    }
  } catch (e: unknown) {
    preloadError = e instanceof Error ? e : new Error("Secret preload failed");
  } finally {
    Atomics.store(ia, 0, 1);
    Atomics.notify(ia, 0);
  }
})();

Atomics.wait(ia, 0, 0);

if (preloadError) {
  throw preloadError;
}
