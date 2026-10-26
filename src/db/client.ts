import "server-only";
import fs from "node:fs";
import path from "node:path";
import { sqliteTables, pgTables } from "./schema";

/**
 * Single connection point. Dev uses a local sqlite file (survives refresh);
 * when DATABASE_URL is set (deployed), it uses Postgres.
 *
 * The db handle is intentionally `unknown`: sqlite and pg drizzle builders
 * have incompatible generics, and every query site goes through
 * src/db/queries.ts (or an api route) which casts once at the boundary.
 */
export type LoadedDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: any;
  sqlite?: { exec: (sql: string) => void };
};

let cache: LoadedDb | null = null;
let schemaReady: Promise<void> | null = null;

export async function getDb(): Promise<LoadedDb> {
  if (cache) return cache;

  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    const [{ drizzle }, pg] = await Promise.all([
      import("drizzle-orm/node-postgres"),
      import("pg"),
    ]);
    const pool = new pg.Pool({ connectionString: url });
    cache = { db: drizzle(pool), tables: pgTables };
    return cache;
  }

  const [{ drizzle }, betterSqlite3] = await Promise.all([
    import("drizzle-orm/better-sqlite3"),
    import("better-sqlite3"),
  ]);
  const file = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "novellia.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Node ESM gives { default: class }; Next's bundler gives the class itself.
  const Ctor = (
    betterSqlite3 as unknown as { default?: unknown; Database?: unknown }
  ).default ?? (betterSqlite3 as unknown as { Database?: unknown }).Database ?? betterSqlite3;
  const sqlite = new (Ctor as new (file: string) => import("better-sqlite3").Database)(file);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  cache = { db, tables: sqliteTables, sqlite };
  return cache;
}

/**
 * Idempotent, lazy schema setup — runs before the first query instead of at
 * module load, so `next build` prerendering never touches a half-created DB.
 * For sqlite this creates tables directly; for Postgres deployments you
 * should run `npm run db:push` (drizzle-kit) as a release step, so this is a
 * no-op there.
 */
export async function initSchema(loaded: LoadedDb): Promise<void> {
  if (loaded.sqlite) {
    if (!schemaReady) schemaReady = Promise.resolve(ensureSqliteSchema(loaded.sqlite));
    return schemaReady;
  }
}

/**
 * Dev convenience: create tables on first boot for the default sqlite file so
 * `npm run dev` works with zero setup. Postgres deployments should run
 * `npm run db:push` (drizzle-kit) as a release step instead.
 */
function ensureSqliteSchema(sqlite: { exec: (sql: string) => void }) {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS pets (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    species TEXT NOT NULL, breed TEXT, sex TEXT, date_of_birth TEXT,
    weight_g INTEGER, notes TEXT, emoji TEXT,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS medical_records (
    id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, type TEXT NOT NULL,
    title TEXT NOT NULL, authored_at TEXT NOT NULL, veterinarian TEXT,
    notes TEXT, details TEXT,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );
  CREATE INDEX IF NOT EXISTS medical_records_pet_idx ON medical_records (pet_id, type);
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );
  CREATE INDEX IF NOT EXISTS chat_messages_pet_idx ON chat_messages (pet_id);`);
}
