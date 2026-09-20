import { describe, expect, it } from "vitest";
import { normalize, parseItem, parseItemsText, stem } from "./text";

describe("normalize / stem", () => {
  it("quita acentos y mayúsculas", () => {
    expect(normalize("  Limón  Verde ")).toBe("limon verde");
  });
  it("singular y plural comparten raíz", () => {
    for (const [a, b] of [["tomate", "tomates"], ["limón", "limones"], ["manzana", "Manzanas"], ["patata frita", "patatas fritas"], ["mejillón", "mejillones"]]) {
      expect(stem(a!)).toBe(stem(b!));
    }
  });
  it("no rompe palabras cortas", () => {
    expect(stem("gas")).toBe("gas");
    expect(stem("pan")).toBe("pan");
  });
});

describe("parseItem", () => {
  it.each([
    ["Leche", { name: "Leche", qty: 1, unit: null }],
    ["huevos x12", { name: "Huevos", qty: 12, unit: null }],
    ["12 huevos", { name: "Huevos", qty: 12, unit: null }],
    ["2 kg de tomates", { name: "Tomates", qty: 2, unit: "kg" }],
    ["1,5 l leche", { name: "Leche", qty: 1.5, unit: "l" }],
    ["arroz 500g", { name: "Arroz", qty: 500, unit: "g" }],
    ["leche 2", { name: "Leche", qty: 2, unit: null }],
    ["Papel higiénico", { name: "Papel higiénico", qty: 1, unit: null }],
  ])("%s", (input, expected) => {
    expect(parseItem(input)).toEqual(expected);
  });
  it("ignora vacíos", () => {
    expect(parseItem("   ")).toBeNull();
  });
});

describe("parseItemsText", () => {
  it("la coma decimal no separa productos", () => {
    expect(parseItemsText("1,5 kg de tomates, 2 leche")).toEqual([
      { name: "Tomates", qty: 1.5, unit: "kg" },
      { name: "Leche", qty: 2, unit: null },
    ]);
    expect(parseItemsText("arroz 0,5 kg,pan").map((i) => [i.name, i.qty])).toEqual([["Arroz", 0.5], ["Pan", 1]]);
    expect(parseItemsText("huevos x12, 3 yogures").map((i) => i.name)).toEqual(["Huevos", "Yogures"]);
  });

  it("separa por comas y saltos de línea", () => {
    expect(parseItemsText("leche, huevos x12\npan;  2 kg de naranjas").map((i) => i.name)).toEqual(["Leche", "Huevos", "Pan", "Naranjas"]);
  });
});
