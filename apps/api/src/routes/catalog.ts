import { normalize, stem, type CatalogProduct, type Suggestion } from "@compra/shared";
import { all } from "../db";
import { requireUser } from "../auth";
import type { Register } from "./ctx";

export const registerCatalog: Register = (app, { db }) => {
  app.get("/api/categories", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const rows = all(db, "SELECT id, key, name, position FROM categories WHERE household_id = ? ORDER BY position", user.householdId);
    return { categories: rows.map((r) => ({ id: r.id, key: r.key, name: r.name, position: r.position })) };
  });

  /** Catálogo completo del hogar: el cliente lo guarda para autocompletar y categorizar sin conexión. */
  app.get("/api/catalog", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const rows = all(db,
      "SELECT name, stem, category_id, default_unit, use_count FROM products WHERE household_id = ? ORDER BY name", user.householdId);
    const products: CatalogProduct[] = rows.map((r) => ({
      name: r.name, stem: r.stem, categoryId: r.category_id, defaultUnit: r.default_unit, useCount: r.use_count,
    }));
    return { products };
  });

  /** Autocompletado. Sin texto devuelve lo que más se compra en casa. */
  app.get<{ Querystring: { q?: string } }>("/api/products/suggest", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const q = normalize(req.query.q ?? "").replace(/[%_\\]/g, "").slice(0, 60);
    const rows = q
      ? all(db,
          `SELECT name, category_id, default_unit,
             CASE WHEN name_norm LIKE ? THEN 0 WHEN name_norm LIKE ? THEN 1 ELSE 2 END AS rank
           FROM products
           WHERE household_id = ? AND (name_norm LIKE ? OR stem LIKE ?)
           ORDER BY rank, use_count DESC, length(name), name LIMIT 8`,
          `${q}%`, `% ${q}%`, user.householdId, `%${q}%`, `%${stem(q)}%`)
      : all(db,
          `SELECT name, category_id, default_unit FROM products
           WHERE household_id = ? AND use_count > 0 ORDER BY use_count DESC, last_used_at DESC LIMIT 12`,
          user.householdId);
    const suggestions: Suggestion[] = rows.map((r) => ({ name: r.name, categoryId: r.category_id, defaultUnit: r.default_unit }));
    return { suggestions };
  });
};
