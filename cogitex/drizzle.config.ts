import { config as loadEnv } from "dotenv";

// Load .env first, then .env.local (values already set are not overridden).
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://user:pass@localhost:5432/cogitex",
  },
});
