import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrateInvoiceStatuses } from "./migrations";

const globalDb = globalThis as unknown as { freelaDb?: DatabaseSync; freelaSchemaVersion?: number };
export function db() {
  if (!globalDb.freelaDb) {
    // Runtime-created database; never include local records in build tracing.
    const path = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || "data/freeladash.sqlite");
    mkdirSync(dirname(path), { recursive: true });
    const connection = new DatabaseSync(path);
    connection.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password_hash TEXT, google_sub TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL, email TEXT NOT NULL, hourly_rate INTEGER NOT NULL CHECK(hourly_rate > 0),
        color TEXT NOT NULL DEFAULT '#6366f1', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        client_id TEXT NOT NULL REFERENCES clients(id), name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        client_id TEXT NOT NULL REFERENCES clients(id), number TEXT NOT NULL,
        start_date TEXT NOT NULL, end_date TEXT NOT NULL, total INTEGER NOT NULL,
        minutes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('draft', 'pending', 'paid')),
        client_name TEXT NOT NULL, client_email TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, number)
      );
      CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        project_id TEXT NOT NULL REFERENCES projects(id), description TEXT NOT NULL,
        date TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes > 0 AND minutes <= 1440),
        hourly_rate INTEGER NOT NULL CHECK(hourly_rate > 0),
        invoice_id TEXT REFERENCES invoices(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id),
        project_name TEXT NOT NULL, description TEXT NOT NULL, date TEXT NOT NULL,
        minutes INTEGER NOT NULL, hourly_rate INTEGER NOT NULL, amount INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS entries_user_date ON time_entries(user_id, date);
      CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id);
      CREATE INDEX IF NOT EXISTS clients_user ON clients(user_id);
      CREATE INDEX IF NOT EXISTS invoices_user ON invoices(user_id);
    `);
    globalDb.freelaDb = connection;
  }
  // Apply new schema even when Fast Refresh reuses an existing connection.
  if (globalDb.freelaSchemaVersion !== 2) {
    globalDb.freelaDb.exec(`
      CREATE TABLE IF NOT EXISTS timer_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        description TEXT NOT NULL, started_at INTEGER NOT NULL, stopped_at INTEGER,
        hourly_rate INTEGER NOT NULL CHECK(hourly_rate > 0), entry_ids TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS timer_user_active ON timer_sessions(user_id) WHERE stopped_at IS NULL;
    `);
    migrateInvoiceStatuses(globalDb.freelaDb);
    globalDb.freelaSchemaVersion = 2;
  }
  return globalDb.freelaDb;
}
export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN IMMEDIATE");
  try { const result = fn(); db().exec("COMMIT"); return result; }
  catch (error) { db().exec("ROLLBACK"); throw error; }
}
export function allowAuth(key: string): boolean {
  const now = Date.now();
  db().prepare("DELETE FROM auth_attempts WHERE expires < ?").run(now);
  const row = db().prepare("SELECT count FROM auth_attempts WHERE key = ?").get(key);
  if (row && Number(row.count) >= 10) return false;
  db().prepare("INSERT INTO auth_attempts(key, count, expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1").run(key, now + 15 * 60 * 1000);
  return true;
}
