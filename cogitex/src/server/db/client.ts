import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type PgliteDb = PgliteDatabase<typeof schema>;
export type PgJsDb = PostgresJsDatabase<typeof schema>;
/** The app's database handle - either a real PostgreSQL connection or the dev-only in-process PGlite. */
export type AppDb = PgJsDb | PgliteDb;

const globalStore = globalThis as unknown as {
  __cogitexDb?: Promise<AppDb>;
  __cogitexTestDb?: AppDb;
};

async function createDevPglite(): Promise<AppDb> {
  // Persistent on-disk PGlite: dev restarts keep the demo data (org, machines,
  // work orders) so the user does not re-sign-up after every server reload.
  const client = new PGlite(path.join(process.cwd(), ".pglite"));
  const db = drizzlePglite(client, { schema });
  // Self-migrate on first run; later restarts reuse the same data directory.
  await migratePglite(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  console.warn(
    "[cogitex] DATABASE_URL is not set — using on-disk PGlite at ./.pglite (dev only). " +
      "For deploy/production set DATABASE_URL (e.g. a free Neon Postgres).",
  );
  return db;
}

async function createDatabase(): Promise<AppDb> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[cogitex] DATABASE_URL must be set in production. On Vercel: create a Postgres (e.g. Neon) and set DATABASE_URL in Project Settings → Environment Variables.",
      );
    }
    return createDevPglite();
  }
  // postgres.js with prepare:false is serverless/pooler-safe (Neon pgbouncer, Prisma Accelerate-style proxies).
  const isManagedSsl = url.includes("neon.tech") || url.includes("sslmode=require");
  const sql = postgres(url, {
    prepare: false,
    ssl: isManagedSsl ? "require" : undefined,
    max: 10,
    idle_timeout: 20,
  });
  return drizzlePostgres(sql, { schema });
}

/** Singleton database (bounded promise so HMR/concurrent requests share one instance). */
export function getDb(): Promise<AppDb> {
  if (globalStore.__cogitexTestDb) return Promise.resolve(globalStore.__cogitexTestDb);
  if (!globalStore.__cogitexDb) {
    globalStore.__cogitexDb = createDatabase().catch((err) => {
      globalStore.__cogitexDb = undefined;
      throw err;
    });
  }
  return globalStore.__cogitexDb;
}

const testStore = globalThis as unknown as { __cogitexTestDb?: AppDb };

/** Test-only injection point: forces getDb() to return a fresh test database. */
export function __setDbForTests(db: AppDb): void {
  testStore.__cogitexTestDb = db;
}

/** Test-only reset. */
export function __resetDbForTests(): void {
  testStore.__cogitexTestDb = undefined;
}
