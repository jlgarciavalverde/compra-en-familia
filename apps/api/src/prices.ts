import { randomUUID } from "node:crypto";
import { normalize, normalizePrice, stem } from "@compra/shared";
import { get, run, type DB } from "./db";

export interface RecordPrice {
  householdId: string;
  storeId: string;
  name: string;
  /** Euros pagados por `qty` `unit`. */
  paid: number;
  qty: number;
  unit: string | null;
  source: "manual" | "ticket";
  at?: number;
}

/**
 * Apunta un precio pagado: crea o actualiza el producto de esa tienda, guarda el cambio en el historial y
 * enlaza el producto genérico ("leche") con él como **confirmado** (lo que se paga manda sobre lo automático).
 * Devuelve el id del producto de tienda.
 */
export function recordPrice(db: DB, o: RecordPrice): string {
  const st = stem(o.name);
  const n = normalizePrice(o.paid, o.qty, o.unit);
  const at = o.at ?? Date.now();

  const existing = get(db, "SELECT * FROM store_products WHERE store_id = ? AND source = ? AND external_id = ?", o.storeId, o.source, st);
  let id: string;
  if (existing) {
    id = existing.id;
    // El historial guarda solo los cambios de precio (y la primera vez).
    if (existing.price !== n.price) run(db, "INSERT INTO price_history (store_product_id, price, unit_price, at, source) VALUES (?,?,?,?,?)", id, n.price, n.unitPrice, at, o.source);
    run(db,
      `UPDATE store_products SET name = ?, name_norm = ?, pack_qty = ?, pack_unit = ?, price = ?, unit_price = ?, ref_unit = ?, updated_at = ?, active = 1 WHERE id = ?`,
      o.name, normalize(o.name), n.packQty, n.packUnit, n.price, n.unitPrice, n.refUnit, at, id);
  } else {
    id = randomUUID();
    run(db,
      `INSERT INTO store_products (id, household_id, store_id, source, external_id, name, name_norm, pack_qty, pack_unit, price, unit_price, ref_unit, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, o.householdId, o.storeId, o.source, st, o.name, normalize(o.name), n.packQty, n.packUnit, n.price, n.unitPrice, n.refUnit, at);
    run(db, "INSERT INTO price_history (store_product_id, price, unit_price, at, source) VALUES (?,?,?,?,?)", id, n.price, n.unitPrice, at, o.source);
  }
  run(db, "INSERT OR REPLACE INTO product_links (household_id, product_stem, store_id, store_product_id, confirmed) VALUES (?,?,?,?,1)", o.householdId, st, o.storeId, id);
  return id;
}
