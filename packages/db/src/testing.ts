import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Database } from "./index";
import { relations } from "./relations";

const migrationsFolder = new URL("./migrations", import.meta.url).pathname;

// In-process Postgres with the real migrations applied. For tests only.
export async function createTestDb(): Promise<Database> {
  const db = drizzle({ client: new PGlite(), relations });
  await migrate(db, { migrationsFolder });
  return db;
}
