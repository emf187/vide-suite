import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

/** Queries go through either driver; both speak the same drizzle schema shape. */
export type AppDb = PgJsDb | PgliteDb;
type PgJsDb = PostgresJsDatabase<typeof schema>;
type PgliteDb = PgliteDatabase<typeof schema>;

async function createDevPglite(): Promise<AppDb> {
  // Persistent on-disk PGlite: dev restarts keep the demo data (org, people,
  // task templates and the conversation history) across server reloads.
  const client = new PGlite(path.join(process.cwd(), ".pglite"));
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  console.warn(
    "[custos] DATABASE_URL is not set — using on-disk PGlite at ./.pglite (dev only). " +
      "For deploy/production set DATABASE_URL (e.g. a free Neon Postgres).",
  );
  return db as AppDb;
}

async function createDatabase(): Promise<AppDb> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[custos] DATABASE_URL must be set in production. On Vercel: create a Postgres (e.g. Neon) and set DATABASE_URL in Project Settings → Environment Variables.",
      );
    }
    return createDevPglite();
  }
  const isManagedSsl = url.includes("neon.tech") || url.includes("sslmode=require");
  const sql = postgres(url, {
    prepare: false, // serverless/pooler-safe (Neon pgbouncer-style proxies)
    ssl: isManagedSsl ? "require" : undefined,
    max: 10,
    idle_timeout: 20,
  });
  return drizzlePostgres(sql, { schema }) as AppDb;
}

const store = globalThis as unknown as { __custosDb?: Promise<AppDb>; __custosTestDb?: AppDb };

/** Singleton database (bounded promise so HMR/concurrent requests share one instance). */
export function getDb(): Promise<AppDb> {
  if (store.__custosTestDb) return Promise.resolve(store.__custosTestDb);
  if (!store.__custosDb) {
    store.__custosDb = createDatabase().catch((err) => {
      store.__custosDb = undefined;
      throw err;
    });
  }
  return store.__custosDb;
}

/* ------------------------- test hooks (vitest) ------------------------- */
export const __setDbForTests = (db: AppDb): void => {
  store.__custosTestDb = db;
};
export const __resetDbForTests = (): void => {
  store.__custosTestDb = undefined;
};
