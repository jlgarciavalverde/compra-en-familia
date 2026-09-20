import type { CatalogProduct } from "./schemas";
import { normalize, stem } from "./text";

/**
 * Búsqueda en el catálogo del hogar, en el cliente (funciona sin conexión).
 * Mismo criterio que `/api/products/suggest`: prefijo > inicio de palabra > contiene, y luego lo más usado.
 * Sin texto devuelve lo que más se compra.
 */
export function searchCatalog(products: CatalogProduct[], query: string, limit = 8): CatalogProduct[] {
  const q = normalize(query).replace(/[%_\\]/g, "").slice(0, 60);
  if (!q) {
    return products
      .filter((p) => p.useCount > 0)
      .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name, "es"))
      .slice(0, 8);
  }
  const qStem = stem(q);
  return products
    .map((p) => ({ p, norm: normalize(p.name) }))
    .filter(({ p, norm }) => norm.includes(q) || p.stem.includes(qStem))
    .map(({ p, norm }) => ({ p, rank: norm.startsWith(q) ? 0 : norm.includes(` ${q}`) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || b.p.useCount - a.p.useCount || a.p.name.length - b.p.name.length || a.p.name.localeCompare(b.p.name, "es"))
    .slice(0, limit)
    .map((x) => x.p);
}

/** Producto del catálogo que equivale a `name` (singular/plural, sin acentos). */
export function findProduct(products: CatalogProduct[], name: string): CatalogProduct | undefined {
  const st = stem(name);
  return products.find((p) => p.stem === st);
}
