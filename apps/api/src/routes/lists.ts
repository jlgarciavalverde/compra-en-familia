import { randomUUID } from "node:crypto";
import { AddItemsInput, DuplicateInput, ItemPatch, ListInput, ListPatch, RestoreInput, capitalize, normalize, parseItemsText, stem } from "@compra/shared";
import type { SQLInputValue } from "node:sqlite";
import { all, get, run, tx, type DB, type Row } from "../db";
import { HttpError, toItem, toList, type AuthUser } from "../http";
import { requireUser } from "../auth";
import { recordPrice } from "../prices";
import type { Register } from "./ctx";

const LIST_SELECT = `
  SELECT l.*,
    (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id AND i.deleted_at IS NULL) AS total,
    (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id AND i.deleted_at IS NULL AND i.checked_at IS NOT NULL) AS checked
  FROM lists l`;

const summary = (db: DB, id: string) => toList(get(db, `${LIST_SELECT} WHERE l.id = ?`, id)!);

function ownList(db: DB, user: AuthUser, id: string): Row {
  const row = get(db, "SELECT * FROM lists WHERE id = ? AND household_id = ? AND deleted_at IS NULL", id, user.householdId);
  if (!row) throw new HttpError(404, "Lista no encontrada");
  return row;
}

function ownItem(db: DB, user: AuthUser, id: string): Row {
  // Un id creado sin conexión puede haberse fusionado con otro ítem al llegar: se resuelve por alias.
  const row = get(db,
    `SELECT i.* FROM list_items i JOIN lists l ON l.id = i.list_id
     WHERE (i.id = ? OR i.id = (SELECT item_id FROM item_aliases WHERE alias_id = ?))
       AND i.household_id = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL`, id, id, user.householdId);
  if (!row) throw new HttpError(404, "Producto no encontrado");
  return row;
}

function assertCategory(db: DB, user: AuthUser, id: string) {
  if (!get(db, "SELECT 1 AS x FROM categories WHERE id = ? AND household_id = ?", id, user.householdId))
    throw new HttpError(400, "Categoría no válida");
}

function assertMember(db: DB, user: AuthUser, id: string) {
  if (!get(db, "SELECT 1 AS x FROM users WHERE id = ? AND household_id = ? AND removed_at IS NULL", id, user.householdId))
    throw new HttpError(400, "Esa persona no es del hogar");
}

/** Marcar como comprado lo apunta en el historial; desmarcar lo quita (así no se duplica si te equivocas). */
function recordPurchase(db: DB, itemId: string, checked: boolean, userId: string, storeId?: string) {
  if (!checked) {
    run(db, "DELETE FROM purchases WHERE id = ?", itemId);
    return;
  }
  const it = get(db, "SELECT i.*, l.name AS list_name FROM list_items i JOIN lists l ON l.id = i.list_id WHERE i.id = ?", itemId);
  if (!it) return;
  run(db,
    `INSERT OR REPLACE INTO purchases (id, household_id, list_id, list_name, name, stem, category_id, qty, unit, user_id, price, store_id, at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    it.id, it.household_id, it.list_id, it.list_name, it.name, it.stem, it.category_id, it.qty, it.unit, userId, it.price ?? null, storeId ?? null, it.checked_at);
}

const touchList = (db: DB, listId: string) => run(db, "UPDATE lists SET updated_at = ? WHERE id = ?", Date.now(), listId);

export const registerLists: Register = (app, { db, hub, notifier }) => {
  const changed = (user: AuthUser, listId?: string) => hub.broadcast(user.householdId, { type: "changed", listId });

  // ---------- Listas ----------
  app.get<{ Querystring: { archived?: string; template?: string } }>("/api/lists", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const archived = req.query.archived === "1";
    const template = req.query.template === "1";
    const where = template
      ? "l.is_template = 1"
      : `l.is_template = 0 AND l.archived_at IS ${archived ? "NOT NULL" : "NULL"}`;
    const rows = all(db,
      `${LIST_SELECT} WHERE l.household_id = ? AND l.deleted_at IS NULL AND ${where} ORDER BY l.updated_at DESC`,
      user.householdId);
    return { lists: rows.map(toList) };
  });

  app.post("/api/lists", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const b = ListInput.parse(req.body);
    const id = b.id ?? randomUUID();
    const existing = get(db, "SELECT household_id FROM lists WHERE id = ?", id);
    if (existing) {
      if (existing.household_id !== user.householdId) throw new HttpError(409, "Ese identificador ya está en uso");
      return { list: summary(db, id) }; // reenvío de una creación ya aplicada
    }
    const now = Date.now();
    run(db, "INSERT INTO lists (id, household_id, name, emoji, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      id, user.householdId, b.name, b.emoji ?? "🛒", user.id, now, now);
    changed(user, id);
    reply.code(201);
    return { list: summary(db, id) };
  });

  app.get<{ Params: { id: string } }>("/api/lists/:id", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const list = ownList(db, user, req.params.id);
    const items = all(db, "SELECT * FROM list_items WHERE list_id = ? AND deleted_at IS NULL ORDER BY position, created_at, id", list.id);
    return { list: summary(db, list.id), items: items.map(toItem) };
  });

  app.patch<{ Params: { id: string } }>("/api/lists/:id", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const list = ownList(db, user, req.params.id);
    const b = ListPatch.parse(req.body);
    const archivedAt = b.archived === undefined ? list.archived_at : b.archived ? Date.now() : null;
    run(db, "UPDATE lists SET name = ?, emoji = ?, archived_at = ?, updated_at = ? WHERE id = ?",
      b.name ?? list.name, b.emoji ?? list.emoji, archivedAt, Date.now(), list.id);
    changed(user, list.id);
    return { list: summary(db, list.id) };
  });

  app.delete<{ Params: { id: string } }>("/api/lists/:id", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const list = ownList(db, user, req.params.id);
    run(db, "UPDATE lists SET deleted_at = ?, updated_at = ? WHERE id = ?", Date.now(), Date.now(), list.id);
    changed(user, list.id);
    reply.code(204);
  });

  /** Copia una lista. `template: true` la guarda como plantilla; copiar una plantilla da una lista normal. */
  app.post<{ Params: { id: string } }>("/api/lists/:id/duplicate", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const src = ownList(db, user, req.params.id);
    const b = DuplicateInput.parse(req.body ?? {});
    const asTemplate = b.template === true;
    const name = b.name ?? (asTemplate || src.is_template ? src.name : `${src.name} (copia)`.slice(0, 60));
    const id = randomUUID();
    tx(db, () => {
      const now = Date.now();
      run(db, "INSERT INTO lists (id, household_id, name, emoji, is_template, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        id, user.householdId, name, src.emoji, asTemplate ? 1 : 0, user.id, now, now);
      for (const it of all(db, "SELECT * FROM list_items WHERE list_id = ? AND deleted_at IS NULL ORDER BY position, created_at", src.id)) {
        run(db,
          `INSERT INTO list_items (id, list_id, household_id, name, stem, qty, unit, note, category_id, assignee_id, position, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          randomUUID(), id, user.householdId, it.name, it.stem, it.qty, it.unit, it.note, it.category_id, asTemplate ? null : it.assignee_id, it.position, user.id, now, now);
      }
    });
    changed(user, id);
    reply.code(201);
    return { list: summary(db, id) };
  });

  // ---------- Ítems ----------
  app.post<{ Params: { id: string } }>("/api/lists/:id/items", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const list = ownList(db, user, req.params.id);
    const b = AddItemsInput.parse(req.body);

    interface Draft { id?: string; name: string; qty: number; unit: string | null; note?: string | null; categoryId?: string; assigneeId?: string | null }
    const shared = { categoryId: b.categoryId, assigneeId: b.assigneeId, note: b.note };
    const drafts: Draft[] = b.items
      ? b.items.map((i) => ({ ...i, name: capitalize(i.name), qty: i.qty ?? 1, unit: i.unit ?? null }))
      : b.text
        ? parseItemsText(b.text).map((p) => ({ ...p, ...shared }))
        : [{ name: capitalize(b.name!), qty: b.qty ?? 1, unit: b.unit ?? null, ...shared }];
    if (drafts.length === 0) throw new HttpError(400, "No he entendido qué añadir");
    for (const d of drafts) {
      if (d.categoryId) assertCategory(db, user, d.categoryId);
      if (d.assigneeId) assertMember(db, user, d.assigneeId);
    }

    const otros = get(db, "SELECT id FROM categories WHERE household_id = ? AND key = 'otros'", user.householdId)!.id as string;

    const ids = tx(db, () => {
      const now = Date.now();
      const out: string[] = [];
      let seq = 0;
      for (const d of drafts) {
        // Reenvío de un ítem ya creado (misma id): no se hace nada.
        if (d.id && get(db, "SELECT 1 AS x FROM list_items WHERE id = ? UNION SELECT 1 FROM item_aliases WHERE alias_id = ?", d.id, d.id)) {
          out.push(d.id);
          continue;
        }
        const st = stem(d.name);
        const product = get(db, "SELECT * FROM products WHERE household_id = ? AND stem = ?", user.householdId, st);
        const categoryId = d.categoryId ?? product?.category_id ?? otros;

        // Aprende el producto: contador de uso y categoría elegida.
        if (product) {
          run(db, "UPDATE products SET use_count = use_count + 1, last_used_at = ?, category_id = ? WHERE id = ?", now, categoryId, product.id);
        } else {
          run(db,
            "INSERT INTO products (id, household_id, name, name_norm, stem, category_id, use_count, last_used_at) VALUES (?,?,?,?,?,?,1,?)",
            randomUUID(), user.householdId, d.name, normalize(d.name), st, categoryId, now);
        }

        // Si ya está pendiente en la lista, se suma la cantidad en vez de duplicar.
        const existing = get(db,
          "SELECT * FROM list_items WHERE list_id = ? AND stem = ? AND unit IS ? AND checked_at IS NULL AND deleted_at IS NULL",
          list.id, st, d.unit);
        if (existing) {
          run(db, "UPDATE list_items SET qty = qty + ?, updated_at = ? WHERE id = ?", d.qty, now, existing.id);
          if (d.id) run(db, "INSERT OR IGNORE INTO item_aliases (alias_id, item_id) VALUES (?,?)", d.id, existing.id);
          out.push(existing.id);
          continue;
        }
        const id = d.id ?? randomUUID();
        run(db,
          `INSERT INTO list_items (id, list_id, household_id, name, stem, qty, unit, note, category_id, assignee_id, position, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, list.id, user.householdId, d.name, st, d.qty, d.unit, d.note ?? null, categoryId, d.assigneeId ?? null, now + seq++, user.id, now, now);
        out.push(id);
      }
      touchList(db, list.id);
      return out;
    });

    changed(user, list.id);
    reply.code(201);
    const items = ids.map((id) => toItem(get(db, "SELECT * FROM list_items WHERE id = ?", id)!));
    notifier.itemsAdded({ householdId: user.householdId, actorId: user.id, listId: list.id, names: drafts.map((d) => d.name) });
    return { items };
  });

  app.patch<{ Params: { id: string } }>("/api/items/:id", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const item = ownItem(db, user, req.params.id);
    const b = ItemPatch.parse(req.body);
    if (b.categoryId) assertCategory(db, user, b.categoryId);
    if (b.assigneeId) assertMember(db, user, b.assigneeId);
    if (b.storeId && !get(db, "SELECT 1 AS x FROM stores WHERE id = ? AND household_id = ? AND deleted_at IS NULL", b.storeId, user.householdId))
      throw new HttpError(400, "Tienda no válida");

    const sets: string[] = [];
    const params: SQLInputValue[] = [];
    const set = (col: string, v: SQLInputValue) => { sets.push(`${col} = ?`); params.push(v); };

    if (b.name !== undefined) { set("name", capitalize(b.name)); set("stem", stem(b.name)); }
    if (b.qty !== undefined) set("qty", b.qty);
    if (b.unit !== undefined) set("unit", b.unit);
    if (b.note !== undefined) set("note", b.note || null);
    if (b.categoryId !== undefined) {
      set("category_id", b.categoryId);
      run(db, "UPDATE products SET category_id = ? WHERE household_id = ? AND stem = ?", b.categoryId, user.householdId, item.stem);
    }
    if (b.assigneeId !== undefined) set("assignee_id", b.assigneeId);
    if (b.position !== undefined) set("position", b.position);
    if (b.price !== undefined) set("price", b.price);
    if (b.checked !== undefined) {
      set("checked_at", b.checked ? Date.now() : null);
      set("checked_by", b.checked ? user.id : null);
    }
    if (sets.length) {
      set("updated_at", Date.now());
      run(db, `UPDATE list_items SET ${sets.join(", ")} WHERE id = ?`, ...params, item.id);
      if (b.checked !== undefined) recordPurchase(db, item.id, b.checked, user.id, b.storeId);
      if (b.price !== undefined) {
        // El precio apuntado también queda en el historial de compras y alimenta el libro de precios de la tienda.
        run(db, "UPDATE purchases SET price = ?, store_id = COALESCE(?, store_id) WHERE id = ?", b.price, b.storeId ?? null, item.id);
        if (b.price !== null && b.storeId) {
          const now = get(db, "SELECT name, qty, unit FROM list_items WHERE id = ?", item.id)!;
          recordPrice(db, { householdId: user.householdId, storeId: b.storeId, name: now.name, paid: b.price, qty: now.qty, unit: now.unit, source: "manual" });
        }
      }
      touchList(db, item.list_id);
      changed(user, item.list_id);

      const after = get(db, "SELECT * FROM list_items WHERE id = ?", item.id)!;
      if (b.assigneeId && b.assigneeId !== item.assignee_id) {
        notifier.assigned({ householdId: user.householdId, actorId: user.id, assigneeId: b.assigneeId, listId: item.list_id, itemName: after.name });
      }
      if (b.checked === true) {
        const left = get(db, "SELECT COUNT(*) AS n FROM list_items WHERE list_id = ? AND deleted_at IS NULL AND checked_at IS NULL", item.list_id)!.n as number;
        if (left === 0) notifier.listCompleted({ householdId: user.householdId, actorId: user.id, listId: item.list_id });
      }
    }
    return { item: toItem(get(db, "SELECT * FROM list_items WHERE id = ?", item.id)!) };
  });

  app.delete<{ Params: { id: string } }>("/api/items/:id", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const item = ownItem(db, user, req.params.id);
    run(db, "UPDATE list_items SET deleted_at = ?, updated_at = ? WHERE id = ?", Date.now(), Date.now(), item.id);
    touchList(db, item.list_id);
    changed(user, item.list_id);
    reply.code(204);
  });

  app.post<{ Params: { id: string } }>("/api/lists/:id/clear-checked", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const list = ownList(db, user, req.params.id);
    const ids = all(db, "SELECT id FROM list_items WHERE list_id = ? AND checked_at IS NOT NULL AND deleted_at IS NULL", list.id).map((r) => r.id as string);
    if (ids.length) {
      run(db, "UPDATE list_items SET deleted_at = ?, updated_at = ? WHERE list_id = ? AND checked_at IS NOT NULL AND deleted_at IS NULL", Date.now(), Date.now(), list.id);
      touchList(db, list.id);
      changed(user, list.id);
    }
    return { ids };
  });

  /** Deshacer un borrado (individual o "borrar comprados"). */
  app.post("/api/items/restore", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const { ids } = RestoreInput.parse(req.body);
    const listIds = new Set<string>();
    tx(db, () => {
      for (const id of ids) {
        const row = get(db, "SELECT i.list_id FROM list_items i JOIN lists l ON l.id = i.list_id WHERE i.id = ? AND i.household_id = ? AND l.deleted_at IS NULL", id, user.householdId);
        if (!row) continue;
        run(db, "UPDATE list_items SET deleted_at = NULL, updated_at = ? WHERE id = ?", Date.now(), id);
        listIds.add(row.list_id);
      }
      for (const l of listIds) touchList(db, l);
    });
    for (const l of listIds) changed(user, l);
    return { restored: listIds.size > 0 };
  });
};
