import { describe, expect, it } from "vitest";
import type { PriceEntry } from "./schemas";
import { bookIndex, compareStores, estimateItem, estimateList, formatEuro, normalizePrice, paidTotal, toRef, type PricedItem } from "./prices";
import { stem } from "./text";

const entry = (name: string, storeId: string, price: number, over: Partial<PriceEntry> = {}): PriceEntry => ({
  stem: stem(name), storeId, storeProductId: `${storeId}-${name}`, name, price,
  packQty: null, packUnit: null, unitPrice: price, refUnit: "ud", updatedAt: 1, confirmed: true, source: "manual", ...over,
});
const kg = (name: string, storeId: string, perKg: number, over: Partial<PriceEntry> = {}) =>
  entry(name, storeId, perKg, { packQty: 1, packUnit: "kg", unitPrice: perKg, refUnit: "kg", ...over });

const item = (name: string, qty = 1, unit: string | null = null, over: Partial<PricedItem> = {}): PricedItem => ({
  id: name, name, qty, unit, checkedAt: null, ...over,
});

describe("unidades", () => {
  it("convierte a la unidad de referencia", () => {
    expect(toRef(500, "g")).toEqual({ qty: 0.5, ref: "kg" });
    expect(toRef(250, "ml")).toEqual({ qty: 0.25, ref: "l" });
    expect(toRef(2, "kg")).toEqual({ qty: 2, ref: "kg" });
    expect(toRef(3, null)).toEqual({ qty: 3, ref: "ud" });
    expect(toRef(2, "pack")).toEqual({ qty: 2, ref: "ud" });
  });

  it("normaliza lo pagado a precio por unidad de referencia", () => {
    expect(normalizePrice(2.99, 1.5, "kg").unitPrice).toBeCloseTo(1.9933, 3);
    expect(normalizePrice(1.5, 500, "g")).toMatchObject({ unitPrice: 3, refUnit: "kg", packQty: 1, packUnit: "kg" });
    expect(normalizePrice(2.7, 3, null)).toMatchObject({ unitPrice: 0.9, price: 0.9, refUnit: "ud", packQty: null });
    expect(normalizePrice(1, 0, "l").unitPrice).toBe(1); // cantidad inválida: se trata como 1
  });
});

describe("estimateItem", () => {
  it("unidades: cantidad × precio del envase", () => {
    expect(estimateItem({ qty: 3, unit: null }, entry("Leche", "m", 0.92))).toBe(2.76);
    expect(estimateItem({ qty: 2, unit: "pack" }, entry("Yogures", "m", 1.6))).toBe(3.2);
  });
  it("peso o volumen: cantidad × precio por kg/l, con conversión", () => {
    expect(estimateItem({ qty: 2, unit: "kg" }, kg("Tomates", "m", 1.99))).toBe(3.98);
    expect(estimateItem({ qty: 500, unit: "g" }, kg("Tomates", "m", 2))).toBe(1);
  });
  it("no inventa: kg contra un precio por unidad no se puede", () => {
    expect(estimateItem({ qty: 2, unit: "kg" }, entry("Tomates", "m", 1.99))).toBeNull();
    expect(estimateItem({ qty: 1, unit: "l" }, kg("Leche", "m", 1))).toBeNull();
  });
});

describe("estimateList", () => {
  const book = [entry("Leche", "m", 0.92), kg("Tomates", "m", 2), entry("Pan", "m", 0.5, { confirmed: false })];
  const idx = bookIndex(book);

  it("suma lo que tiene precio y cuenta el resto", () => {
    const est = estimateList([item("Leche", 2), item("Tomates", 1.5, "kg"), item("Pan"), item("Caviar")], idx, "m");
    expect(est).toMatchObject({ total: 5.34, priced: 3, count: 4, unconfirmed: 1 });
    expect(est.lines.find((l) => l.itemId === "Caviar")!.cost).toBeNull();
  });

  it("empareja singular y plural", () => {
    expect(estimateList([item("Tomate", 1, "kg")], idx, "m").total).toBe(2);
  });

  it("lo pagado de verdad manda sobre la estimación", () => {
    const est = estimateList([item("Leche", 2, null, { checkedAt: 5, price: 1.7 })], idx, "m");
    expect(est.total).toBe(1.7);
    expect(est.lines[0]).toMatchObject({ actual: true, entry: null });
  });

  it("un precio pagado en un producto aún sin marcar no cuenta", () => {
    expect(estimateList([item("Leche", 2, null, { price: 1.7 })], idx, "m").total).toBe(1.84);
  });

  it("paidTotal suma solo lo marcado con precio", () => {
    expect(paidTotal([item("a", 1, null, { checkedAt: 1, price: 2 }), item("b", 1, null, { price: 9 }), item("c", 1, null, { checkedAt: 1, price: 1.5 }), item("d", 1, null, { checkedAt: 1 })]))
      .toEqual({ total: 3.5, count: 2 });
  });
});

describe("compareStores", () => {
  const book = [
    entry("Leche", "M", 0.92), entry("Leche", "F", 0.85),
    entry("Huevos", "M", 2.5), entry("Huevos", "F", 2.9),
    entry("Pan", "M", 0.6),                      // solo en Mercadona
    kg("Tomates", "F", 1.5),                     // solo en Family Cash
  ];
  const idx = bookIndex(book);
  const items = [item("Leche", 2), item("Huevos"), item("Pan"), item("Tomates", 2, "kg"), item("Caviar")];

  it("compara solo lo que tiene precio en todas las tiendas", () => {
    const c = compareStores(items, idx, ["M", "F"]);
    expect(c.comparable).toBe(2);                       // leche y huevos
    const m = c.stores.find((s) => s.storeId === "M")!;
    const f = c.stores.find((s) => s.storeId === "F")!;
    expect(m.total).toBe(4.34);                         // 1,84 + 2,50
    expect(f.total).toBe(4.6);                          // 1,70 + 2,90
    expect(c.cheapestStoreId).toBe("M");
    expect(c.gap).toBe(0.26);
  });

  it("informa de la cobertura de cada tienda", () => {
    const c = compareStores(items, idx, ["M", "F"]);
    expect(c.stores.find((s) => s.storeId === "M")).toMatchObject({ priced: 3, coverage: 0.6 });
    expect(c.stores.find((s) => s.storeId === "F")).toMatchObject({ priced: 3, coverage: 0.6 });
  });

  it("calcula el ahorro repartiendo la compra", () => {
    const c = compareStores(items, idx, ["M", "F"]);
    // Leche más barata en F (1,70 vs 1,84) y huevos en M (2,50 vs 2,90): 4,20 frente a 4,34 → 0,14
    expect(c.splitSavings).toBe(0.14);
  });

  it("marca la tienda más barata de cada producto y cuánto se ahorra", () => {
    const rows = compareStores(items, idx, ["M", "F"]).rows;
    expect(rows.find((r) => r.name === "Leche")).toMatchObject({ cheapestStoreId: "F", saving: 0.14 });
    expect(rows.find((r) => r.name === "Huevos")).toMatchObject({ cheapestStoreId: "M", saving: 0.4 });
    expect(rows.find((r) => r.name === "Pan")).toMatchObject({ cheapestStoreId: null, saving: null });
  });

  it("una tienda sin ningún precio no compite ni falsea los totales", () => {
    const c = compareStores(items, idx, ["M", "F", "D"]);
    expect(c.stores.find((s) => s.storeId === "D")).toMatchObject({ total: null, priced: 0, coverage: 0 });
    expect(c.comparable).toBe(2);
    expect(c.cheapestStoreId).toBe("M");
  });

  it("con una sola tienda con datos no hay comparación", () => {
    const c = compareStores([item("Pan"), item("Leche")], bookIndex([entry("Pan", "M", 0.6), entry("Leche", "M", 0.9)]), ["M", "F"]);
    expect(c.cheapestStoreId).toBeNull();
    expect(c.gap).toBe(0);
    expect(c.splitSavings).toBe(0);
    expect(c.stores.find((s) => s.storeId === "M")!.total).toBe(1.5);
  });

  it("sin datos devuelve ceros", () => {
    const c = compareStores([item("Pan")], bookIndex([]), ["M", "F"]);
    expect(c).toMatchObject({ comparable: 0, cheapestStoreId: null, gap: 0, splitSavings: 0 });
  });
});

describe("formato", () => {
  it("euros en español", () => {
    expect(formatEuro(46.2)).toBe("46,20 €");
    expect(formatEuro(1234.5)).toBe("1234,50 €"); // en español, las cifras de cuatro dígitos no llevan punto
  });
});
