import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { project, ticket, user } from "./schema";
import { createTestDb } from "./testing";

test("applies migrations and supports app tables", async () => {
  const db = await createTestDb();
  await db.insert(user).values({ id: "u1", name: "Client", email: "c@example.com", role: "user" });
  const [p] = await db.insert(project).values({ slug: "acme", name: "Acme" }).returning();
  expect(p?.id).toBeString();
  expect(p?.runbook).toBe("");

  const [t] = await db.insert(ticket).values({ projectId: p!.id, authorId: "u1", title: "Checkout broken" }).returning();
  expect(t?.status).toBe("received");

  const rows = await db.select().from(ticket).where(eq(ticket.projectId, p!.id));
  expect(rows).toHaveLength(1);
});
