import { all, get } from "../db";
import { requireUser } from "../auth";
import type { Register } from "./ctx";

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const registerExport: Register = (app, { db }) => {
  /** Todos los datos del hogar, para llevárselos: JSON completo o CSV de las listas. */
  app.get<{ Querystring: { format?: string } }>("/api/export", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const hid = user.householdId;
    const day = new Date().toISOString().slice(0, 10);

    const cats = all(db, "SELECT id, name FROM categories WHERE household_id = ? ORDER BY position", hid);
    const catName = new Map(cats.map((c) => [c.id as string, c.name as string]));
    const members = all(db, "SELECT id, name, role, removed_at FROM users WHERE household_id = ? ORDER BY created_at", hid);
    const memberName = new Map(members.map((m) => [m.id as string, m.name as string]));
    const lists = all(db, "SELECT * FROM lists WHERE household_id = ? AND deleted_at IS NULL ORDER BY created_at", hid);
    const items = all(db, "SELECT * FROM list_items WHERE household_id = ? AND deleted_at IS NULL ORDER BY position, created_at", hid);
    const rows = lists.flatMap((l) =>
      items.filter((i) => i.list_id === l.id).map((i) => ({
        lista: l.name, plantilla: l.is_template ? "sí" : "no", archivada: l.archived_at ? "sí" : "no",
        pasillo: catName.get(i.category_id) ?? "", producto: i.name, cantidad: i.qty, unidad: i.unit ?? "",
        nota: i.note ?? "", comprado: i.checked_at ? "sí" : "no", asignado_a: memberName.get(i.assignee_id) ?? "",
      })));

    if (req.query.format === "csv") {
      const cols = ["lista", "plantilla", "archivada", "pasillo", "producto", "cantidad", "unidad", "nota", "comprado", "asignado_a"] as const;
      const body = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="compra-en-familia-${day}.csv"`)
        // BOM para que Excel abra bien las tildes.
        .send("﻿" + body);
    }

    const purchases = all(db, "SELECT name, qty, unit, list_name, category_id, user_id, price, store_id, at FROM purchases WHERE household_id = ? ORDER BY at", hid);
    const storeRows = all(db, "SELECT id, name, chain FROM stores WHERE household_id = ? AND deleted_at IS NULL ORDER BY name", hid);
    const storeName = new Map(storeRows.map((s) => [s.id as string, s.name as string]));
    const prices = all(db,
      `SELECT l.product_stem, l.store_id, l.confirmed, sp.name, sp.price, sp.unit_price, sp.ref_unit, sp.updated_at
       FROM product_links l JOIN store_products sp ON sp.id = l.store_product_id WHERE l.household_id = ? ORDER BY sp.name`, hid);
    const data = {
      exportedAt: new Date().toISOString(),
      household: get(db, "SELECT name, created_at FROM households WHERE id = ?", hid),
      members: members.map((m) => ({ name: m.name, role: m.role, removed: m.removed_at != null })),
      categories: cats.map((c) => c.name),
      lists: lists.map((l) => ({
        name: l.name, emoji: l.emoji, template: l.is_template === 1, archived: l.archived_at != null,
        items: items.filter((i) => i.list_id === l.id).map((i) => ({
          name: i.name, qty: i.qty, unit: i.unit, note: i.note, category: catName.get(i.category_id),
          checked: i.checked_at != null, assignedTo: memberName.get(i.assignee_id) ?? null,
        })),
      })),
      stores: storeRows.map((s) => ({ name: s.name, chain: s.chain })),
      prices: prices.map((p) => ({
        product: p.name, store: storeName.get(p.store_id) ?? null, price: p.price, unitPrice: p.unit_price,
        per: p.ref_unit, confirmed: p.confirmed === 1, updatedAt: new Date(p.updated_at).toISOString(),
      })),
      purchases: purchases.map((p) => ({
        name: p.name, qty: p.qty, unit: p.unit, list: p.list_name, category: catName.get(p.category_id),
        boughtBy: memberName.get(p.user_id) ?? null, paid: p.price ?? null, store: storeName.get(p.store_id) ?? null,
        at: new Date(p.at).toISOString(),
      })),
    };
    return reply
      .header("Content-Disposition", `attachment; filename="compra-en-familia-${day}.json"`)
      .send(data);
  });
};
