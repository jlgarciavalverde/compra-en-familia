import { randomUUID } from "node:crypto";
import { StoreInput, StorePatch, type Store } from "@compra/shared";
import { all, get, run, tx, type DB } from "../db";
import { HttpError, type AuthUser } from "../http";
import { requireUser } from "../auth";
import type { Register } from "./ctx";

/** Orden de pasillos de una tienda; las categorías que no tenga puestas van al final, en el orden por defecto. */
function storeOrder(db: DB, householdId: string, storeId: string): string[] {
  const own = all(db, "SELECT category_id FROM store_aisles WHERE store_id = ? ORDER BY position", storeId).map((r) => r.category_id as string);
  const rest = all(db, "SELECT id FROM categories WHERE household_id = ? ORDER BY position", householdId)
    .map((r) => r.id as string)
    .filter((id) => !own.includes(id));
  return [...own, ...rest];
}

const toStore = (db: DB, householdId: string, r: { id: string; name: string; chain?: string | null }): Store => ({
  id: r.id,
  name: r.name,
  chain: (r.chain ?? null) as Store["chain"],
  order: storeOrder(db, householdId, r.id),
});

function validateOrder(db: DB, user: AuthUser, order: string[]) {
  if (new Set(order).size !== order.length) throw new HttpError(400, "Hay pasillos repetidos");
  for (const id of order) {
    if (!get(db, "SELECT 1 AS x FROM categories WHERE id = ? AND household_id = ?", id, user.householdId))
      throw new HttpError(400, "Categoría no válida");
  }
}

function setOrder(db: DB, storeId: string, order: string[]) {
  run(db, "DELETE FROM store_aisles WHERE store_id = ?", storeId);
  order.forEach((cat, i) => run(db, "INSERT INTO store_aisles (store_id, category_id, position) VALUES (?,?,?)", storeId, cat, i));
}

const ownStore = (db: DB, user: AuthUser, id: string) => {
  const row = get(db, "SELECT * FROM stores WHERE id = ? AND household_id = ? AND deleted_at IS NULL", id, user.householdId);
  if (!row) throw new HttpError(404, "Tienda no encontrada");
  return row;
};

export const registerStores: Register = (app, { db, hub }) => {
  const changed = (user: AuthUser) => hub.broadcast(user.householdId, { type: "changed" });

  app.get("/api/stores", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const rows = all(db, "SELECT id, name, chain FROM stores WHERE household_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE", user.householdId);
    return { stores: rows.map((r) => toStore(db, user.householdId, r as { id: string; name: string; chain: string | null })) };
  });

  app.post("/api/stores", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const b = StoreInput.parse(req.body);
    const order = b.order ?? [];
    validateOrder(db, user, order);
    const id = randomUUID();
    tx(db, () => {
      run(db, "INSERT INTO stores (id, household_id, name, chain, created_at) VALUES (?,?,?,?,?)", id, user.householdId, b.name, b.chain ?? null, Date.now());
      setOrder(db, id, order);
    });
    changed(user);
    reply.code(201);
    return { store: toStore(db, user.householdId, { id, name: b.name, chain: b.chain ?? null }) };
  });

  app.patch<{ Params: { id: string } }>("/api/stores/:id", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const store = ownStore(db, user, req.params.id);
    const b = StorePatch.parse(req.body);
    if (b.order) validateOrder(db, user, b.order);
    tx(db, () => {
      if (b.name) run(db, "UPDATE stores SET name = ? WHERE id = ?", b.name, store.id);
      if (b.chain !== undefined) run(db, "UPDATE stores SET chain = ? WHERE id = ?", b.chain, store.id);
      if (b.order) setOrder(db, store.id, b.order);
    });
    changed(user);
    return { store: toStore(db, user.householdId, { id: store.id, name: b.name ?? store.name, chain: b.chain !== undefined ? b.chain : store.chain }) };
  });

  app.delete<{ Params: { id: string } }>("/api/stores/:id", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const store = ownStore(db, user, req.params.id);
    run(db, "UPDATE stores SET deleted_at = ? WHERE id = ?", Date.now(), store.id);
    changed(user);
    reply.code(204);
  });
};
