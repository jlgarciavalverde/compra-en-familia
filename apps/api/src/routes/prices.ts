import { ManualPriceInput, type PriceEntry } from "@compra/shared";
import { all, get, run, type DB } from "../db";
import { HttpError, type AuthUser } from "../http";
import { requireUser } from "../auth";
import { recordPrice } from "../prices";
import type { Register } from "./ctx";

const ownStore = (db: DB, user: AuthUser, id: string) => {
  const s = get(db, "SELECT * FROM stores WHERE id = ? AND household_id = ? AND deleted_at IS NULL", id, user.householdId);
  if (!s) throw new HttpError(404, "Tienda no encontrada");
  return s;
};

const toEntry = (r: Record<string, any>): PriceEntry => ({
  stem: r.product_stem, storeId: r.store_id, storeProductId: r.id, name: r.name, price: r.price,
  packQty: r.pack_qty, packUnit: r.pack_unit, unitPrice: r.unit_price, refUnit: r.ref_unit,
  updatedAt: r.updated_at, confirmed: r.confirmed === 1, source: r.source,
});

const ENTRY_SELECT = `
  SELECT l.product_stem, l.store_id, l.confirmed, sp.*
  FROM product_links l
  JOIN store_products sp ON sp.id = l.store_product_id
  JOIN stores s ON s.id = l.store_id AND s.deleted_at IS NULL`;

export const registerPrices: Register = (app, { db, hub }) => {
  /** Libro de precios del hogar: pequeño, el móvil se lo guarda y calcula estimaciones sin conexión. */
  app.get("/api/prices/book", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const rows = all(db, `${ENTRY_SELECT} WHERE l.household_id = ? AND sp.active = 1`, user.householdId);
    return { book: rows.map(toEntry) };
  });

  /** Precio apuntado a mano: `price` € por `qty` `unit`. */
  app.put("/api/prices/manual", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const b = ManualPriceInput.parse(req.body);
    ownStore(db, user, b.storeId);
    const id = recordPrice(db, { householdId: user.householdId, storeId: b.storeId, name: b.name, paid: b.price, qty: b.qty ?? 1, unit: b.unit ?? null, source: "manual" });
    hub.broadcast(user.householdId, { type: "changed" });
    const row = get(db, `${ENTRY_SELECT} WHERE sp.id = ? AND l.household_id = ?`, id, user.householdId)!;
    return { entry: toEntry(row) };
  });

  /** Quita el precio de un producto en una tienda. */
  app.delete<{ Querystring: { stem?: string; storeId?: string } }>("/api/prices/manual", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const { stem, storeId } = req.query;
    if (!stem || !storeId) throw new HttpError(400, "Faltan datos");
    ownStore(db, user, storeId);
    const link = get(db, "SELECT store_product_id FROM product_links WHERE household_id = ? AND product_stem = ? AND store_id = ?", user.householdId, stem, storeId);
    if (link) {
      run(db, "DELETE FROM product_links WHERE household_id = ? AND product_stem = ? AND store_id = ?", user.householdId, stem, storeId);
      // El producto de tienda solo se borra si era un precio apuntado a mano y nadie más lo usa.
      run(db, "DELETE FROM store_products WHERE id = ? AND source = 'manual' AND NOT EXISTS (SELECT 1 FROM product_links WHERE store_product_id = ?)", link.store_product_id, link.store_product_id);
    }
    hub.broadcast(user.householdId, { type: "changed" });
    reply.code(204);
  });

  /** Evolución del precio de un producto en una tienda. */
  app.get<{ Querystring: { stem?: string; storeId?: string } }>("/api/prices/history", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const { stem, storeId } = req.query;
    if (!stem || !storeId) throw new HttpError(400, "Faltan datos");
    ownStore(db, user, storeId);
    const rows = all(db,
      `SELECT h.price, h.unit_price, h.at, h.source
       FROM price_history h JOIN product_links l ON l.store_product_id = h.store_product_id
       WHERE l.household_id = ? AND l.product_stem = ? AND l.store_id = ? ORDER BY h.at`,
      user.householdId, stem, storeId);
    return { points: rows.map((r) => ({ at: r.at, price: r.price, unitPrice: r.unit_price, source: r.source })) };
  });
};
