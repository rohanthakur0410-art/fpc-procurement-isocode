import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

export function openDatabase(dbPath: string): DB {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS centres (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_mr TEXT NOT NULL,
  slip_counter INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('operator','office')),
  name TEXT NOT NULL,
  centre_code TEXT REFERENCES centres(code)
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  farmer_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_mr TEXT NOT NULL,
  village TEXT NOT NULL,
  village_mr TEXT NOT NULL,
  land_acres REAL NOT NULL,
  bank_account_masked TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY,
  price_date TEXT NOT NULL,
  crop TEXT NOT NULL,
  grade TEXT NOT NULL,
  rate_rupees INTEGER NOT NULL,
  set_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(price_date, crop, grade)
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  client_uuid TEXT UNIQUE NOT NULL,
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  centre_code TEXT NOT NULL REFERENCES centres(code),
  member_id INTEGER NOT NULL REFERENCES members(id),
  crop TEXT NOT NULL,
  grade TEXT NOT NULL,
  gross_tenths INTEGER NOT NULL,
  tare_tenths INTEGER NOT NULL,
  moisture_tenths INTEGER NOT NULL,
  net_tenths INTEGER NOT NULL,
  rate_rupees INTEGER NOT NULL,
  amount_paisa INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('approved','flagged','paid')),
  flags TEXT NOT NULL DEFAULT '[]',
  photo_name TEXT,
  device_ts TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  draft_id TEXT,
  price_reviewed_at TEXT,
  slip_no TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_purchases_centre ON purchases(centre_code, device_ts);
CREATE INDEX IF NOT EXISTS idx_purchases_member ON purchases(member_id, device_ts);
CREATE TABLE IF NOT EXISTS device_chains (
  device_id TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL,
  last_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_runs (
  id INTEGER PRIMARY KEY,
  run_date TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  total_paisa INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'file_generated' CHECK(status IN ('file_generated','paid'))
);
CREATE TABLE IF NOT EXISTS payment_items (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES payment_runs(id),
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  amount_paisa INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sms_outbox (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent')),
  queued_at TEXT NOT NULL,
  sent_at TEXT
);
`);
  const columns = db.prepare('PRAGMA table_info(purchases)').all() as {name:string}[];
  if(!columns.some(c=>c.name==='draft_id')) db.exec('ALTER TABLE purchases ADD COLUMN draft_id TEXT');
  if(!columns.some(c=>c.name==='price_reviewed_at')) db.exec('ALTER TABLE purchases ADD COLUMN price_reviewed_at TEXT');
}
