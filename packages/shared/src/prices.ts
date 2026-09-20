import type { PriceEntry } from "./schemas";
import { stem } from "./text";

export type RefUnit = "kg" | "l" | "ud";

/** Cantidad expresada en su unidad de referencia: g→kg, ml→l; unidades, paquetes y "sin unidad" → ud. */
export function toRef(qty: number, unit: string | null): { qty: number; ref: RefUnit } {
  switch (unit) {
    case "kg": return { qty, ref: "kg" };
    case "g": return { qty: qty / 1000, ref: "kg" };
    case "l": return { qty, ref: "l" };
    case "ml": return { qty: qty / 1000, ref: "l" };
    default: return { qty, ref: "ud" };
  }
}

export interface NormalizedPrice {
  /** € del envase o de la unidad (para kg/l es el precio por kg/l). */
  price: number;
  unitPrice: number;
  refUnit: RefUnit;
  packQty: number | null;
  packUnit: RefUnit | null;
}

/** Convierte "pagué `paid` € por `qty` `unit`" en un precio comparable (€/kg, €/l o €/ud). */
export function normalizePrice(paid: number, qty: number, unit: string | null): NormalizedPrice {
  const r = toRef(qty > 0 ? qty : 1, unit);
  const unitPrice = round4(paid / r.qty);
  return r.ref === "ud"
    ? { price: unitPrice, unitPrice, refUnit: "ud", packQty: null, packUnit: null }
    : { price: unitPrice, unitPrice, refUnit: r.ref, packQty: 1, packUnit: r.ref };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Precio por unidad con 4 decimales: evita restos como 0,7999999 y basta para comparar. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Cuánto costará este producto con el precio de esta tienda.
 * - En kg/l: cantidad × precio por kg/l (solo si el precio está expresado en la misma unidad).
 * - En unidades/paquetes: cantidad × precio del envase.
 * Devuelve null si no se puede convertir: no se inventan precios.
 */
export function estimateItem(item: { qty: number; unit: string | null }, entry: PriceEntry): number | null {
  const r = toRef(item.qty, item.unit);
  if (r.ref === "ud") return round2(item.qty * entry.price);
  if (entry.refUnit !== r.ref || entry.unitPrice == null) return null;
  return round2(r.qty * entry.unitPrice);
}

export interface PricedItem {
  id: string;
  name: string;
  qty: number;
  unit: string | null;
  checkedAt: number | null;
  price?: number | null;
}

export type PriceIndex = Map<string, PriceEntry>;
const key = (itemStem: string, storeId: string) => `${itemStem}\u0000${storeId}`;

export function bookIndex(book: PriceEntry[]): PriceIndex {
  return new Map(book.map((e) => [key(e.stem, e.storeId), e]));
}

export interface LineEstimate {
  itemId: string;
  cost: number | null;
  entry: PriceEntry | null;
  /** true = es lo que se pagó de verdad, no una estimación. */
  actual: boolean;
}

export interface ListEstimate {
  total: number;
  /** Productos con precio (estimado o pagado) y total de productos considerados. */
  priced: number;
  count: number;
  /** Cuántos de los precios usados son sugerencias sin confirmar. */
  unconfirmed: number;
  lines: LineEstimate[];
}

/** Coste de una lista en una tienda: lo pagado cuenta tal cual; lo demás, según el libro de precios. */
export function estimateList(items: PricedItem[], index: PriceIndex, storeId: string): ListEstimate {
  const lines: LineEstimate[] = items.map((i) => {
    if (i.checkedAt && i.price != null) return { itemId: i.id, cost: i.price, entry: null, actual: true };
    const entry = index.get(key(stem(i.name), storeId)) ?? null;
    return { itemId: i.id, cost: entry ? estimateItem(i, entry) : null, entry, actual: false };
  });
  const priced = lines.filter((l) => l.cost !== null);
  return {
    total: round2(priced.reduce((n, l) => n + l.cost!, 0)),
    priced: priced.length,
    count: items.length,
    unconfirmed: priced.filter((l) => l.entry && !l.entry.confirmed).length,
    lines,
  };
}

/** Lo pagado por lo que ya está en el carro. */
export function paidTotal(items: PricedItem[]): { total: number; count: number } {
  const paid = items.filter((i) => i.checkedAt && i.price != null);
  return { total: round2(paid.reduce((n, i) => n + i.price!, 0)), count: paid.length };
}

export interface StoreTotals {
  storeId: string;
  /** Total sobre los productos comparables (o null si la tienda no tiene ningún precio). */
  total: number | null;
  /** Productos de la lista con precio en esta tienda. */
  priced: number;
  coverage: number;
  unconfirmed: number;
}

export interface ComparisonRow {
  itemId: string;
  name: string;
  costs: Record<string, number | null>;
  cheapestStoreId: string | null;
  /** Solo si hay al menos dos tiendas con precio para este producto. */
  saving: number | null;
}

export interface Comparison {
  stores: StoreTotals[];
  /** Productos con precio en todas las tiendas comparadas: la "cesta comparable". */
  comparable: number;
  cheapestStoreId: string | null;
  /** Diferencia entre la tienda más cara y la más barata en la cesta comparable. */
  gap: number;
  /** Lo que se ahorraría comprando cada cosa donde sale más barata, frente a la mejor tienda única. */
  splitSavings: number;
  rows: ComparisonRow[];
}

/**
 * Compara tiendas de forma justa: el total de cada una se calcula solo sobre los productos que tienen
 * precio en todas las tiendas que tienen algún dato. Las tiendas sin ningún precio se listan pero no compiten.
 */
export function compareStores(items: PricedItem[], index: PriceIndex, storeIds: string[]): Comparison {
  const perStore = storeIds.map((storeId) => ({ storeId, est: estimateList(items, index, storeId) }));
  const active = perStore.filter((s) => s.est.priced > 0);
  const costOf = (storeId: string, i: number) => perStore.find((s) => s.storeId === storeId)!.est.lines[i]!.cost;

  const comparableIdx = items.map((_, i) => i).filter((i) => active.length > 0 && active.every((s) => costOf(s.storeId, i) !== null));

  const stores: StoreTotals[] = perStore.map(({ storeId, est }) => {
    const isActive = est.priced > 0;
    return {
      storeId,
      total: isActive ? round2(comparableIdx.reduce((n, i) => n + costOf(storeId, i)!, 0)) : null,
      priced: est.priced,
      coverage: items.length ? est.priced / items.length : 0,
      unconfirmed: est.unconfirmed,
    };
  });

  const ranked = stores.filter((s) => s.total !== null).sort((a, b) => a.total! - b.total!);
  const cheapest = active.length >= 2 && ranked.length ? ranked[0]! : null;
  const gap = active.length >= 2 && ranked.length ? round2(ranked.at(-1)!.total! - ranked[0]!.total!) : 0;

  const rows: ComparisonRow[] = items.map((it, i) => {
    const costs = Object.fromEntries(storeIds.map((s) => [s, costOf(s, i)]));
    const have = Object.entries(costs).filter((e): e is [string, number] => e[1] !== null);
    const min = have.length ? have.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
    const max = have.length ? Math.max(...have.map((h) => h[1])) : 0;
    return {
      itemId: it.id, name: it.name, costs,
      cheapestStoreId: have.length >= 2 ? min![0] : null,
      saving: have.length >= 2 ? round2(max - min![1]) : null,
    };
  });

  const bestSingle = ranked[0]?.total ?? 0;
  const splitTotal = comparableIdx.reduce((n, i) => n + Math.min(...active.map((s) => costOf(s.storeId, i)!)), 0);

  return {
    stores,
    comparable: comparableIdx.length,
    cheapestStoreId: cheapest?.storeId ?? null,
    gap,
    splitSavings: active.length >= 2 ? round2(Math.max(0, bestSingle - splitTotal)) : 0,
    rows,
  };
}

const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const formatEuro = (n: number) => euro.format(n).replace(/ /g, " ");

/** "1,99 €/kg" */
export const formatUnitPrice = (e: Pick<PriceEntry, "unitPrice" | "refUnit">) =>
  e.unitPrice == null || !e.refUnit ? "" : `${formatEuro(e.unitPrice)}/${e.refUnit === "ud" ? "ud" : e.refUnit}`;
