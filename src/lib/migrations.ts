import type { DatabaseSync } from "node:sqlite";

export function migrateInvoiceStatuses(connection: DatabaseSync) {
  const schema = () => String(connection.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'").get()?.sql || "");
  if (schema().includes("'draft'")) return;
  // SQLite requires rebuilding the table to extend a CHECK constraint.
  // Disable FK enforcement outside the transaction, preserving all child links.
  const foreignKeys = Number(connection.prepare("PRAGMA foreign_keys").get()?.foreign_keys);
  connection.exec("PRAGMA foreign_keys = OFF");
  let started = false;
  try {
    connection.exec("BEGIN IMMEDIATE");
    started = true;
    // Another process may have migrated while we waited for the write lock.
    if (!schema().includes("'draft'")) {
      connection.exec(`
        CREATE TABLE invoices_with_drafts (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          client_id TEXT NOT NULL REFERENCES clients(id), number TEXT NOT NULL,
          start_date TEXT NOT NULL, end_date TEXT NOT NULL, total INTEGER NOT NULL,
          minutes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('draft', 'pending', 'paid')),
          client_name TEXT NOT NULL, client_email TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, number)
        );
        INSERT INTO invoices_with_drafts SELECT * FROM invoices;
        DROP TABLE invoices;
        ALTER TABLE invoices_with_drafts RENAME TO invoices;
        CREATE INDEX invoices_user ON invoices(user_id);
      `);
      if (connection.prepare("PRAGMA foreign_key_check").all().length) {
        throw new Error("Não foi possível migrar os status: vínculos inválidos no banco.");
      }
    }
    connection.exec("COMMIT");
  } catch (error) {
    if (started) connection.exec("ROLLBACK");
    throw error;
  } finally {
    connection.exec(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
}
