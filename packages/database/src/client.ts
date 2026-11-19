import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  driver: "postgres" | "pglite";
  close(): Promise<void>;
}

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

/**
 * Production: DATABASE_URL pointing at Neon (or any Postgres with pgvector).
 * Local development and tests: embedded PGlite (real Postgres compiled to WASM, with pgvector),
 * so the whole platform runs without any external database.
 *
 * url: "postgres://..." | "memory://" | "file://<dir>" | undefined (→ ./.data/pglite)
 */
export async function createDatabase(url?: string, opts: { migrate?: boolean } = {}): Promise<DatabaseHandle> {
  const migrate = opts.migrate ?? true;

  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10), prepare: false });
    const db = drizzle(client, { schema }) as unknown as Database;
    if (migrate) {
      await client.unsafe("CREATE EXTENSION IF NOT EXISTS vector");
      const { migrate: run } = await import("drizzle-orm/postgres-js/migrator");
      await run(db as never, { migrationsFolder });
    }
    return { db, driver: "postgres", close: () => client.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { drizzle } = await import("drizzle-orm/pglite");
  let dataDir: string | undefined;
  if (url === "memory://") dataDir = undefined;
  else {
    dataDir = url?.startsWith("file://") ? url.slice("file://".length) : path.resolve(process.cwd(), ".data/pglite");
    mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite({ ...(dataDir ? { dataDir } : {}), extensions: { vector } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector");
  const db = drizzle(client, { schema }) as unknown as Database;
  if (migrate) {
    const { migrate: run } = await import("drizzle-orm/pglite/migrator");
    await run(db as never, { migrationsFolder });
  }
  return { db, driver: "pglite", close: () => client.close() };
}
