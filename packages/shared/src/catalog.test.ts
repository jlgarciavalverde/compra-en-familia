import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "./schemas";
import { findProduct, searchCatalog } from "./catalog";
import { stem } from "./text";

const p = (name: string, useCount = 0, categoryId = "c1"): CatalogProduct => ({ name, stem: stem(name), categoryId, defaultUnit: null, useCount });
const catalog = [p("Limones"), p("Limonada", 3), p("Leche", 9), p("Leche de avena", 2), p("Tomates"), p("Salsa de tomate"), p("Pan", 5)];

describe("searchCatalog", () => {
  it("ordena prefijo, luego inicio de palabra, luego contiene", () => {
    expect(searchCatalog(catalog, "tomat").map((x) => x.name)).toEqual(["Tomates", "Salsa de tomate"]);
  });
  it("entre iguales manda el más usado", () => {
    expect(searchCatalog(catalog, "lim").map((x) => x.name)).toEqual(["Limonada", "Limones"]);
  });
  it("ignora acentos y mayúsculas", () => {
    expect(searchCatalog(catalog, "LIMÓN").map((x) => x.name)).toContain("Limones");
  });
  it("sin texto devuelve lo más comprado", () => {
    expect(searchCatalog(catalog, "").map((x) => x.name)).toEqual(["Leche", "Pan", "Limonada", "Leche de avena"]);
  });
  it("respeta el límite", () => {
    expect(searchCatalog(catalog, "l", 2)).toHaveLength(2);
  });
});

describe("findProduct", () => {
  it("encuentra por singular o plural", () => {
    expect(findProduct(catalog, "tomate")?.name).toBe("Tomates");
    expect(findProduct(catalog, "LIMÓN")?.name).toBe("Limones");
    expect(findProduct(catalog, "caviar")).toBeUndefined();
  });
});
