import { expect, test } from "bun:test";

import { createTestDb } from "@ashbot/db/testing";

import { createAuth } from "./index";

const env = { BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "x".repeat(32), CORS_ORIGIN: "http://localhost:3001" };

test("public sign-up is disabled but server-side user creation works with roles", async () => {
  const auth = createAuth(env, await createTestDb());

  await expect(
    auth.api.signUpEmail({ body: { email: "someone@example.com", password: "password123", name: "Someone" } }),
  ).rejects.toThrow();

  const { user } = await auth.api.createUser({
    body: { email: "client@example.com", password: "password123", name: "Client", role: "user" },
  });
  expect(user.role).toBe("user");

  const signedIn = await auth.api.signInEmail({
    body: { email: "client@example.com", password: "password123" },
    asResponse: true,
  });
  expect(signedIn.status).toBe(200);
  const cookie = signedIn.headers.get("set-cookie") ?? "";
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.user.email).toBe("client@example.com");
  expect(session?.user.role).toBe("user");
});
