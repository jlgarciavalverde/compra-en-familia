import type { Purchase, SuggestedProduct } from "@compra/shared";
import { all } from "../db";
import { requireUser } from "../auth";
import type { Register } from "./ctx";

const DAY = 24 * 3600 * 1000;

/**
 * Un producto "suele faltar" cuando lo habéis comprado en al menos dos días distintos y ya ha pasado
 * (casi) el intervalo medio entre compras desde la última vez, siempre que no esté ya pendiente en una lista.
 */
export function suggestProducts(
  rows: Array<{ stem: string; name: string; category_id: string; at: number }>,
  pendingStems: Set<string>,
  now: number,
): SuggestedProduct[] {
  const byStem = new Map<string, { name: string; categoryId: string; days: Set<number>; last: number }>();
  for (const r of rows) {
    const e = byStem.get(r.stem) ?? { name: r.name, categoryId: r.category_id, days: new Set<number>(), last: 0 };
    e.days.add(Math.floor(r.at / DAY));
    if (r.at >= e.last) { e.last = r.at; e.name = r.name; e.categoryId = r.category_id; }
    byStem.set(r.stem, e);
  }

  const out: Array<SuggestedProduct & { ratio: number }> = [];
  for (const [stem, e] of byStem) {
    if (e.days.size < 2 || pendingStems.has(stem)) continue;
    const days = [...e.days].sort((a, b) => a - b);
    const avg = (days[days.length - 1]! - days[0]!) / (days.length - 1);
    const since = (now - e.last) / DAY;
    const ratio = since / Math.max(avg, 1);
    // Ni demasiado pronto, ni tan tarde que ya no lo compráis.
    if (since < 2 || ratio < 0.85 || ratio > 6) continue;
    out.push({ name: e.name, categoryId: e.categoryId, everyDays: Math.round(avg), daysSince: Math.floor(since), ratio });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, 10).map(({ ratio: _r, ...s }) => s);
}

export const registerInsights: Register = (app, { db }) => {
  /** Historial de lo comprado, lo más reciente primero. `before` (ms) pagina hacia atrás. */
  app.get<{ Querystring: { limit?: string; before?: string } }>("/api/history", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const before = Number(req.query.before) || Date.now() + DAY;
    const rows = all(db,
      "SELECT * FROM purchases WHERE household_id = ? AND at < ? ORDER BY at DESC, id LIMIT ?",
      user.householdId, before, limit + 1);
    const purchases: Purchase[] = rows.slice(0, limit).map((r) => ({
      id: r.id, listId: r.list_id, listName: r.list_name, name: r.name, categoryId: r.category_id,
      qty: r.qty, unit: r.unit, userId: r.user_id, price: r.price ?? null, storeId: r.store_id ?? null, at: r.at,
    }));
    return { purchases, hasMore: rows.length > limit };
  });

  app.get("/api/suggestions", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const now = Date.now();
    const rows = all(db,
      "SELECT stem, name, category_id, at FROM purchases WHERE household_id = ? AND at > ? ORDER BY at",
      user.householdId, now - 180 * DAY) as Array<{ stem: string; name: string; category_id: string; at: number }>;
    const pending = new Set(all(db,
      `SELECT DISTINCT i.stem FROM list_items i JOIN lists l ON l.id = i.list_id
       WHERE l.household_id = ? AND l.deleted_at IS NULL AND l.archived_at IS NULL AND l.is_template = 0
         AND i.deleted_at IS NULL AND i.checked_at IS NULL`, user.householdId).map((r) => r.stem as string));
    return { suggestions: suggestProducts(rows, pending, now) };
  });
};
