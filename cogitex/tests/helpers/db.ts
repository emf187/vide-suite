import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

/**
 * Fresh in-memory Postgres (PGlite) per test — same SQL/migrations as production,
 * no external service. This is what keeps tenancy tests deterministic.
 */
export async function createTestDb(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  return db;
}

export function testId(): string {
  return Math.random().toString(36).slice(2, 10);
}
