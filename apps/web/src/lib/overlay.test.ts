import { describe, expect, it } from "vitest";
import type { Item, ListDetail, ListSummary } from "@compra/shared";
import { applyToDetail, overlayDetail, overlayLists, synthDetail, type NewItem, type Op } from "./overlay";

const ME = "u1";
const list = (over: Partial<ListSummary> = {}): ListSummary => ({ id: "L", name: "Súper", emoji: "🛒", archived: false, template: false, total: 0, checked: 0, updatedAt: 1, ...over });
const item = (over: Partial<Item> = {}): Item => ({
  id: "i1", listId: "L", name: "Leche", qty: 1, unit: null, note: null, categoryId: "c", assigneeId: null,
  checkedAt: null, checkedBy: null, createdBy: ME, position: 1, price: null, updatedAt: 1, ...over,
});
const detail = (items: Item[]): ListDetail => ({ list: list({ total: items.length, checked: items.filter((i) => i.checkedAt).length }), items });
const add = (items: NewItem[], at = 10, id = "op" + at): Op => ({ id, at, kind: "addItems", listId: "L", items });
const n = (over: Partial<NewItem> = {}): NewItem => ({ id: "n1", name: "pan", qty: 1, unit: null, categoryId: "c", ...over });

describe("applyToDetail", () => {
  it("añade un producto nuevo con nombre capitalizado y actualiza contadores", () => {
    const d = applyToDetail(detail([]), add([n()]), ME);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ id: "n1", name: "Pan", createdBy: ME });
    expect(d.list.total).toBe(1);
  });

  it("fusiona con el pendiente del mismo producto (singular/plural) y misma unidad", () => {
    const d = applyToDetail(detail([item({ name: "Huevos", qty: 12 })]), add([n({ name: "huevo", qty: 6 })]), ME);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]!.qty).toBe(18);
  });

  it("no fusiona si la unidad es distinta o ya está comprado", () => {
    const base = detail([item({ name: "Leche", unit: "l" }), item({ id: "i2", name: "Pan", checkedAt: 5 })]);
    const d = applyToDetail(applyToDetail(base, add([n({ id: "a", name: "leche", unit: null })]), ME), add([n({ id: "b", name: "pan" })], 11), ME);
    expect(d.items.map((i) => i.name)).toEqual(["Leche", "Pan", "Leche", "Pan"]);
  });

  it("marcar y desmarcar", () => {
    const on = applyToDetail(detail([item()]), { id: "o", at: 20, kind: "updateItem", listId: "L", itemId: "i1", patch: { checked: true } }, ME);
    expect(on.items[0]).toMatchObject({ checkedAt: 20, checkedBy: ME });
    expect(on.list.checked).toBe(1);
    const off = applyToDetail(on, { id: "o2", at: 21, kind: "updateItem", listId: "L", itemId: "i1", patch: { checked: false } }, ME);
    expect(off.items[0]).toMatchObject({ checkedAt: null, checkedBy: null });
  });

  it("edita solo los campos del cambio", () => {
    const d = applyToDetail(detail([item()]), { id: "o", at: 20, kind: "updateItem", listId: "L", itemId: "i1", patch: { qty: 3, unit: "l", note: "sin lactosa" } }, ME);
    expect(d.items[0]).toMatchObject({ name: "Leche", qty: 3, unit: "l", note: "sin lactosa" });
  });

  it("eliminar y deshacer", () => {
    const it = item();
    const gone = applyToDetail(detail([it]), { id: "o", at: 30, kind: "deleteItem", listId: "L", item: it }, ME);
    expect(gone.items).toHaveLength(0);
    const back = applyToDetail(gone, { id: "o2", at: 31, kind: "restoreItems", listId: "L", items: [it] }, ME);
    expect(back.items.map((i) => i.id)).toEqual(["i1"]);
    // Restaurar dos veces no duplica.
    expect(applyToDetail(back, { id: "o3", at: 32, kind: "restoreItems", listId: "L", items: [it] }, ME).items).toHaveLength(1);
  });

  it("vaciar comprados", () => {
    const d = applyToDetail(detail([item(), item({ id: "i2", checkedAt: 5 })]), { id: "o", at: 40, kind: "clearChecked", listId: "L" }, ME);
    expect(d.items.map((i) => i.id)).toEqual(["i1"]);
    expect(d.list).toMatchObject({ total: 1, checked: 0 });
  });

  it("apuntar y quitar el precio de una línea", () => {
    const d = applyToDetail(detail([item()]), { id: "o", at: 60, kind: "updateItem", listId: "L", itemId: "i1", patch: { checked: true, price: 2.7, storeId: "tienda" } }, ME);
    expect(d.items[0]).toMatchObject({ price: 2.7, checkedAt: 60 });
    const clean = applyToDetail(d, { id: "o2", at: 61, kind: "updateItem", listId: "L", itemId: "i1", patch: { price: null } }, ME);
    expect(clean.items[0]!.price).toBeNull();
  });

  it("mover un producto cambia su posición y el orden", () => {
    const base = detail([item({ id: "a", position: 1 }), item({ id: "b", name: "Pan", position: 2 }), item({ id: "c", name: "Sal", position: 3 })]);
    const d = applyToDetail(base, { id: "o", at: 50, kind: "updateItem", listId: "L", itemId: "c", patch: { position: 1.5 } }, ME);
    expect(d.items.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("los productos nuevos se colocan al final, en el orden en que se añadieron", () => {
    const d = applyToDetail(detail([item({ position: 5 })]), add([n({ id: "x", name: "uno" }), n({ id: "y", name: "dos" })], 100), ME);
    expect(d.items.map((i) => i.name)).toEqual(["Leche", "Uno", "Dos"]);
  });

  it("ignora cambios de otra lista", () => {
    const base = detail([item()]);
    expect(applyToDetail(base, { ...add([n()]), listId: "OTRA" } as Op, ME)).toBe(base);
  });
});

describe("overlayDetail", () => {
  it("aplica varios cambios en orden sobre los datos del servidor", () => {
    const ops: Op[] = [
      add([n({ id: "a", name: "yogur" })], 10),
      { id: "x", at: 11, kind: "updateItem", listId: "L", itemId: "a", patch: { checked: true } },
    ];
    const d = overlayDetail(detail([item()]), ops, ME);
    expect(d.items.map((i) => [i.name, !!i.checkedAt])).toEqual([["Leche", false], ["Yogur", true]]);
    expect(d.list).toMatchObject({ total: 2, checked: 1 });
  });

  it("si el servidor ya trae el cambio (llegó de otro modo), no se duplica", () => {
    const base = detail([item({ id: "a", name: "Yogur" })]);
    const d = overlayDetail(base, [add([n({ id: "a", name: "yogur" })])], ME);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]!.qty).toBe(1);
  });
});

describe("overlayLists", () => {
  it("devuelve la base si no hay cambios", () => {
    const base = [list()];
    expect(overlayLists(base, [], () => undefined, ME)).toBe(base);
  });

  it("actualiza contadores de una lista con cambios pendientes", () => {
    const base = [list({ total: 1, checked: 0 })];
    const out = overlayLists(base, [add([n()])], () => detail([item()]), ME)!;
    expect(out[0]).toMatchObject({ total: 2, checked: 0 });
  });

  it("muestra las listas creadas sin conexión, con sus productos, y ordena por actividad", () => {
    const create: Extract<Op, { kind: "createList" }> = { id: "c1", at: 100, kind: "createList", list: { id: "NEW", name: "Fiesta", emoji: "🎉" } };
    const addToNew: Op = { id: "a1", at: 101, kind: "addItems", listId: "NEW", items: [n({ id: "z", name: "globos" })] };
    const out = overlayLists([list()], [create, addToNew], () => undefined, ME)!;
    expect(out.map((l) => l.name)).toEqual(["Fiesta", "Súper"]);
    expect(out[0]).toMatchObject({ total: 1, checked: 0 });
  });

  it("synthDetail crea una lista vacía", () => {
    expect(synthDetail({ id: "c", at: 5, kind: "createList", list: { id: "N", name: "X", emoji: "🛒" } }).items).toEqual([]);
  });
});
