import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: any };
import fs from "node:fs";
import path from "node:path";
const file = process.env.DB_FILE ?? "./data/fielddesk.db";
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db: any = new DatabaseSync(file);
db.exec(
  `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('dispatcher','technician','admin')),password_hash TEXT NOT NULL,created_at TEXT NOT NULL,tenant_id TEXT NOT NULL DEFAULT 'default'); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,priority TEXT NOT NULL,site TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','assigned','en_route','on_site','blocked','completed','cancelled')),assigned_to TEXT REFERENCES users(id),due_at TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,tenant_id TEXT NOT NULL DEFAULT 'default'); CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),object_key TEXT NOT NULL,content_type TEXT NOT NULL,sha256 TEXT NOT NULL,uploaded_at TEXT,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,job_id TEXT NOT NULL,metadata TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,topic TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,published_at TEXT); CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(published_at,created_at);`,
);
for (const statement of [
  "ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
  "ALTER TABLE jobs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
]) {
  try {
    db.exec(statement);
  } catch {
    // Existing local databases already carry the tenant columns.
  }
}
