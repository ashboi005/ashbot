import { createAuth } from "@ashbot/auth";
import { createTestDb } from "@ashbot/db/testing";
import { project, projectMember } from "@ashbot/db/schema";
import { createLocalStorage } from "@ashbot/integrations/storage";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp, type AppDeps } from "../app";

const authEnv = { BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "x".repeat(32), CORS_ORIGIN: "http://localhost:3001" };

export async function setup(overrides: Partial<AppDeps> = {}) {
  const db = await createTestDb();
  const auth = createAuth(authEnv, db);
  const storage = createLocalStorage(await mkdtemp(join(tmpdir(), "ashbot-test-")));
  const deps: AppDeps = {
    db,
    auth,
    storage,
    webOrigin: "http://localhost:3001",
    corsOrigin: authEnv.CORS_ORIGIN,
    transcribe: async () => ({ transcript: "checkout kaam nahi kar raha", languages: ["hi", "en"] }),
    cleanup: async () => "The checkout is not working.",
    ...overrides,
  };
  const app = createApp(deps);

  async function request(path: string, init: RequestInit & { cookie?: string; json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    return app.handle(new Request(`http://localhost${path}`, { ...init, headers, body }));
  }

  async function signIn(email: string, password = "password123") {
    const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${res.status}`);
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  async function createUser(role: "admin" | "user", email: string, name = email.split("@")[0] ?? email) {
    const { user } = await auth.api.createUser({ body: { email, password: "password123", name, role } });
    return { id: user.id, cookie: await signIn(email) };
  }

  async function createProject(slug: string, name = slug) {
    const [row] = await db.insert(project).values({ slug, name }).returning();
    return row!;
  }

  async function addMember(userId: string, projectId: string) {
    await db.insert(projectMember).values({ userId, projectId });
  }

  return { db, auth, storage, app, deps, request, signIn, createUser, createProject, addMember };
}

export function uploadForm(bytes: Uint8Array, type: string, name: string) {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  return form;
}
