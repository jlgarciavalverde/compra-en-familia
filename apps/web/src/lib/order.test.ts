import { describe, expect, it } from "vitest";
import { positionFor } from "./order";

const list = (...ps: number[]) => ps.map((position, i) => ({ id: String.fromCharCode(97 + i), position }));

describe("positionFor", () => {
  it("no hace nada si el orden ya es correcto o está solo", () => {
    expect(positionFor(list(1, 2, 3), "b")).toBeNull();
    expect(positionFor(list(5), "a")).toBeNull();
    expect(positionFor(list(1, 2), "zzz")).toBeNull();
  });

  it("al mover al principio se queda antes del primero", () => {
    // orden nuevo: c, a, b (c tenía posición 3)
    const order = [{ id: "c", position: 3 }, { id: "a", position: 1 }, { id: "b", position: 2 }];
    expect(positionFor(order, "c")).toBe(0);
  });

  it("al mover al final se queda después del último", () => {
    const order = [{ id: "b", position: 2 }, { id: "c", position: 3 }, { id: "a", position: 1 }];
    expect(positionFor(order, "a")).toBe(4);
  });

  it("al mover entre dos se coloca en medio", () => {
    const order = [{ id: "a", position: 1 }, { id: "c", position: 3 }, { id: "b", position: 2 }, { id: "d", position: 10 }];
    expect(positionFor(order, "c")).toBe(1.5 + 0); // entre a(1) y b(2)
  });

  it("varios movimientos seguidos mantienen el orden", () => {
    type P = { id: string; position: number };
    const move = (items: P[], id: string, toIndex: number): P[] => {
      const order = items.filter((x) => x.id !== id);
      order.splice(toIndex, 0, items.find((x) => x.id === id)!);
      const pos = positionFor(order, id);
      return order.map((x) => (x.id === id && pos !== null ? { ...x, position: pos } : x));
    };
    const ids = (items: P[]) => [...items].sort((a, b) => a.position - b.position).map((x) => x.id);

    let items: P[] = list(1000, 2000, 3000, 4000);   // a b c d
    items = move(items, "d", 1);                     // a d b c
    expect(ids(items)).toEqual(["a", "d", "b", "c"]);
    items = move(items, "c", 2);                     // a d c b
    expect(ids(items)).toEqual(["a", "d", "c", "b"]);
    items = move(items, "a", 3);                     // d c b a
    expect(ids(items)).toEqual(["d", "c", "b", "a"]);
    items = move(items, "b", 0);                     // b d c a
    expect(ids(items)).toEqual(["b", "d", "c", "a"]);
  });
});
