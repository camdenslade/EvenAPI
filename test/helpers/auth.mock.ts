export interface MockAuthUser {
  uid: string;
  email?: string | null;
  phone_number?: string | null;
}

export function mockAuthUser(
  uid: string,
  email?: string | null,
  phone?: string | null,
): MockAuthUser {
  return {
    uid,
    email: email ?? null,
    phone_number: phone ?? null,
  };
}

export function createMockAuthProvider(
  users: Map<string, MockAuthUser> = new Map(),
) {
  return {
    auth: () => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      verifyIdToken: jest.fn(async (token: string) => {
        const uid = token.startsWith("token-")
          ? token.replace("token-", "")
          : token;
        const user = users.get(uid);

        if (token.includes("revoked")) {
          const error: any = new Error("Token has been revoked");
          error.code = "auth/id-token-revoked";
          throw error;
        }

        if (!user) {
          const error: any = new Error("Token verification failed");
          error.code = "auth/id-token-expired";
          throw error;
        }

        return {
          uid: user.uid,
          email: user.email ?? null,
          phone_number: user.phone_number ?? null,
        };
      }),
    }),
  };
}
