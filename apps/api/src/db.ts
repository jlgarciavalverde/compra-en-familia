import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE households (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','member')),
    avatar_color TEXT NOT NULL,
    avatar_emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_by TEXT REFERENCES users(id),
    used_at INTEGER
  );
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    UNIQUE (household_id, key)
  );
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    stem TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    default_unit TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    UNIQUE (household_id, stem)
  );
  CREATE INDEX products_search ON products (household_id, name_norm);
  CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    name TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    deleted_at INTEGER
  );
  CREATE INDEX lists_household ON lists (household_id, deleted_at);
  CREATE TABLE list_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id),
    household_id TEXT NOT NULL REFERENCES households(id),
    name TEXT NOT NULL,
    stem TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 1,
    unit TEXT,
    note TEXT,
    category_id TEXT NOT NULL REFERENCES categories(id),
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    checked_at INTEGER,
    checked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX items_list ON list_items (list_id, deleted_at);
  `,
  // 2: idempotencia de mutaciones reenviadas desde la cola offline + alias de ítems fusionados
  `
  CREATE TABLE applied_mutations (
    key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (key, user_id)
  );
  CREATE TABLE item_aliases (
    alias_id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES list_items(id)
  );
  `,
  // 3: quitar miembros, orden manual, plantillas, tiendas con orden de pasillos e historial de compras
  `
  ALTER TABLE users ADD COLUMN removed_at INTEGER;
  ALTER TABLE list_items ADD COLUMN position REAL NOT NULL DEFAULT 0;
  UPDATE list_items SET position = created_at;
  ALTER TABLE lists ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE stores (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE TABLE store_aisles (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id),
    position INTEGER NOT NULL,
    PRIMARY KEY (store_id, category_id)
  );
  CREATE TABLE purchases (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    list_id TEXT,
    list_name TEXT NOT NULL,
    name TEXT NOT NULL,
    stem TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    qty REAL NOT NULL,
    unit TEXT,
    user_id TEXT REFERENCES users(id),
    at INTEGER NOT NULL
  );
  CREATE INDEX purchases_household_at ON purchases (household_id, at);
  CREATE INDEX purchases_stem ON purchases (household_id, stem, at);
  `,
  // 4: precios. Libro de precios por tienda, historial de precios y enlace producto genérico → producto de tienda
  `
  ALTER TABLE stores ADD COLUMN chain TEXT;
  ALTER TABLE list_items ADD COLUMN price REAL;
  ALTER TABLE purchases ADD COLUMN price REAL;
  ALTER TABLE purchases ADD COLUMN store_id TEXT;
  CREATE TABLE store_products (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    store_id TEXT NOT NULL REFERENCES stores(id),
    source TEXT NOT NULL CHECK (source IN ('catalog','ticket','manual')),
    external_id TEXT,
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    pack_qty REAL,
    pack_unit TEXT,
    price REAL NOT NULL,
    unit_price REAL,
    ref_unit TEXT,
    updated_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (store_id, source, external_id)
  );
  CREATE INDEX store_products_store ON store_products (store_id, name_norm);
  CREATE TABLE price_history (
    store_product_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    unit_price REAL,
    at INTEGER NOT NULL,
    source TEXT NOT NULL
  );
  CREATE INDEX price_history_product ON price_history (store_product_id, at);
  CREATE TABLE product_links (
    household_id TEXT NOT NULL REFERENCES households(id),
    product_stem TEXT NOT NULL,
    store_id TEXT NOT NULL REFERENCES stores(id),
    store_product_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
    confirmed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (household_id, product_stem, store_id)
  );
  `,
  // 5: recuperar el acceso (sin email), claves de notificaciones y suscripciones push
  `
  CREATE TABLE password_resets (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
  CREATE TABLE notification_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    added INTEGER NOT NULL DEFAULT 1,
    assigned INTEGER NOT NULL DEFAULT 1,
    shopping INTEGER NOT NULL DEFAULT 1,
    completed INTEGER NOT NULL DEFAULT 1
  );
  `,
];

function migrate(db: DB) {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

/** Transacción síncrona: no hacer `await` dentro de `fn`. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export type Row = Record<string, any>;
export const get = (db: DB, sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params) as Row | undefined;
export const all = (db: DB, sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params) as Row[];
export const run = (db: DB, sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
