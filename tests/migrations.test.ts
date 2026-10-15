import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateInvoiceStatuses } from "../src/lib/migrations";

function legacyDatabase() {
  const connection = new DatabaseSync(":memory:");
  connection.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE clients (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('user');
    INSERT INTO clients VALUES ('client');
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL REFERENCES clients(id), number TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, total INTEGER NOT NULL,
      minutes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid')),
      client_name TEXT NOT NULL, client_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, number)
    );
    CREATE INDEX invoices_user ON invoices(user_id);
    CREATE TABLE time_entries (id TEXT PRIMARY KEY, invoice_id TEXT REFERENCES invoices(id));
    CREATE TABLE invoice_items (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), description TEXT);
    INSERT INTO invoices VALUES ('pending','user','client','FD-0001','2026-10-01','2026-10-15',12500,60,'pending','Cliente','cliente@example.com','2026-10-15 10:00:00');
    INSERT INTO invoices VALUES ('paid','user','client','FD-0002','2026-09-01','2026-09-30',25000,120,'paid','Cliente','cliente@example.com','2026-09-30 10:00:00');
    INSERT INTO time_entries VALUES ('entry','pending');
    INSERT INTO invoice_items VALUES ('item','pending','Trabalho preservado');
  `);
  return connection;
}

test("migração preserva cobranças existentes, índices, vínculos e restrições", () => {
  const connection = legacyDatabase();
  try {
    const invoices = connection.prepare("SELECT * FROM invoices ORDER BY id").all();
    const entries = connection.prepare("SELECT * FROM time_entries").all();
    const items = connection.prepare("SELECT * FROM invoice_items").all();
    migrateInvoiceStatuses(connection);
    migrateInvoiceStatuses(connection);
    assert.deepEqual(connection.prepare("SELECT * FROM invoices ORDER BY id").all(), invoices);
    assert.deepEqual(connection.prepare("SELECT * FROM time_entries").all(), entries);
    assert.deepEqual(connection.prepare("SELECT * FROM invoice_items").all(), items);
    assert.deepEqual(connection.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(connection.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    assert.ok(connection.prepare("SELECT name FROM sqlite_master WHERE name='invoices_user'").get());
    connection.prepare("UPDATE invoices SET status='draft' WHERE id='pending'").run();
    assert.equal(connection.prepare("SELECT status FROM invoices WHERE id='pending'").get()?.status, "draft");
    assert.throws(() => connection.exec("UPDATE invoices SET status='invalid'"));
    assert.throws(() => connection.exec("UPDATE invoices SET number='FD-0001' WHERE id='paid'"));
    assert.throws(() => connection.exec("DELETE FROM invoices WHERE id='pending'"));
    assert.throws(() => connection.exec("UPDATE time_entries SET invoice_id='missing'"));
    connection.exec("INSERT INTO invoices(id,user_id,client_id,number,start_date,end_date,total,minutes,client_name,client_email) VALUES('new','user','client','FD-0003','2026-10-01','2026-10-15',100,1,'Cliente','cliente@example.com')");
    assert.equal(connection.prepare("SELECT status FROM invoices WHERE id='new'").get()?.status, "pending");
  } finally { connection.close(); }
});

test("falha na migração restaura a tabela original e a proteção dos vínculos", () => {
  const connection = legacyDatabase();
  try {
    connection.exec("PRAGMA foreign_keys = OFF; UPDATE time_entries SET invoice_id='missing'; PRAGMA foreign_keys = ON;");
    const before = connection.prepare("SELECT * FROM invoices ORDER BY id").all();
    assert.throws(() => migrateInvoiceStatuses(connection), /vínculos inválidos/);
    assert.deepEqual(connection.prepare("SELECT * FROM invoices ORDER BY id").all(), before);
    assert.equal(connection.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    assert.throws(() => connection.exec("UPDATE invoices SET status='draft'"));
    assert.equal(connection.prepare("SELECT name FROM sqlite_master WHERE name='invoices_with_drafts'").get(), undefined);
  } finally { connection.close(); }
});
