import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app";
import { all } from "./db";

let app: App;
let ana: string;
let luis: string;
let listId: string;
let mercadona: string;
let familyCash: string;

type Json = Record<string, any>;
async function call(method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: method as "GET", url, payload: payload as object | undefined,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  let body: any = res.body;
  try { body = JSON.parse(res.body); } catch { /* texto */ }
  return { status: res.statusCode, body: body as Json };
}
const addItem = async (text: string, token = ana) => (await call("POST", `/api/lists/${listId}/items`, token, { text })).body.items[0] as Json;
const book = async (token = ana) => (await call("GET", "/api/prices/book", token)).body.book as Json[];

beforeAll(async () => {
  app = await buildApp({ dbPath: ":memory:", version: "t", setupCode: "setup", allowedOrigins: [], logLevel: "silent" });
  ana = (await call("POST", "/api/auth/register", undefined, { name: "Ana", email: "ana@casa.es", password: "supersecreta1", setupCode: "setup", householdName: "Casa" })).body.token;
  const inv = await call("POST", "/api/household/invites", ana);
  luis = (await call("POST", "/api/auth/register", undefined, { name: "Luis", email: "luis@casa.es", password: "otrasecreta1", inviteCode: inv.body.code })).body.token;
  listId = (await call("POST", "/api/lists", ana, { name: "Súper" })).body.list.id;
  mercadona = (await call("POST", "/api/stores", ana, { name: "Mercadona", chain: "mercadona" })).body.store.id;
  familyCash = (await call("POST", "/api/stores", ana, { name: "Family Cash", chain: "familycash" })).body.store.id;
});
afterAll(() => app.close());

describe("tiendas con cadena", () => {
  it("guarda y cambia la cadena", async () => {
    const stores = (await call("GET", "/api/stores", ana)).body.stores as Json[];
    expect(stores.find((s) => s.id === mercadona)!.chain).toBe("mercadona");
    const r = await call("PATCH", `/api/stores/${familyCash}`, ana, { chain: "dumbo" });
    expect(r.body.store.chain).toBe("dumbo");
    await call("PATCH", `/api/stores/${familyCash}`, ana, { chain: "familycash" });
    expect((await call("PATCH", `/api/stores/${familyCash}`, ana, { chain: "carrefour" })).status).toBe(400);
    expect((await call("PATCH", `/api/stores/${familyCash}`, ana, { chain: null })).body.store.chain).toBeNull();
    await call("PATCH", `/api/stores/${familyCash}`, ana, { chain: "familycash" });
  });
});

describe("apuntar el precio al comprar", () => {
  it("el libro está vacío al principio", async () => {
    expect(await book()).toEqual([]);
  });

  it("el precio del ítem crea el producto de la tienda, lo enlaza como confirmado y lo apunta en el historial", async () => {
    const leche = await addItem("3 leche");
    const r = await call("PATCH", `/api/items/${leche.id}`, luis, { checked: true, storeId: mercadona });
    expect(r.status).toBe(200);
    const priced = await call("PATCH", `/api/items/${leche.id}`, luis, { price: 2.7, storeId: mercadona });
    expect(priced.body.item.price).toBe(2.7);

    const entries = await book();
    expect(entries).toHaveLength(1);
    // 2,70 € por 3 unidades → 0,90 € cada una
    expect(entries[0]).toMatchObject({ stem: "leche", storeId: mercadona, price: 0.9, unitPrice: 0.9, refUnit: "ud", confirmed: true, source: "manual" });

    const h = (await call("GET", "/api/history", ana)).body.purchases.find((p: Json) => p.name === "Leche");
    expect(h).toMatchObject({ price: 2.7, storeId: mercadona });
  });

  it("en kg guarda el precio por kg", async () => {
    const tomates = await addItem("1,5 kg de tomates");
    await call("PATCH", `/api/items/${tomates.id}`, ana, { checked: true, price: 2.99, storeId: mercadona });
    const e = (await book()).find((x) => x.stem === "tomate")!;
    expect(e.refUnit).toBe("kg");
    expect(e.unitPrice).toBeCloseTo(1.9933, 3);
    expect(e).toMatchObject({ packQty: 1, packUnit: "kg" });
  });

  it("la misma cosa en otra tienda queda aparte", async () => {
    const leche = (await call("GET", `/api/lists/${listId}`, ana)).body.items.find((i: Json) => i.name === "Leche");
    await call("PATCH", `/api/items/${leche.id}`, ana, { price: 2.4, storeId: familyCash });
    const entries = (await book()).filter((e) => e.stem === "leche");
    expect(entries.map((e) => [e.storeId, e.unitPrice]).sort()).toEqual([[familyCash, 0.8], [mercadona, 0.9]].sort());
  });

  it("solo se guarda el cambio de precio en el historial de precios", async () => {
    const leche = (await call("GET", `/api/lists/${listId}`, ana)).body.items.find((i: Json) => i.name === "Leche");
    const points = async () => (await call("GET", `/api/prices/history?stem=leche&storeId=${mercadona}`, ana)).body.points as Json[];
    expect(await points()).toHaveLength(1);
    await call("PATCH", `/api/items/${leche.id}`, ana, { price: 2.7, storeId: mercadona });   // igual: no añade
    expect(await points()).toHaveLength(1);
    await call("PATCH", `/api/items/${leche.id}`, ana, { price: 3.3, storeId: mercadona });   // sube a 1,10 €
    const after = await points();
    expect(after).toHaveLength(2);
    expect(after.map((p) => p.price)).toEqual([0.9, 1.1]);
    await call("PATCH", `/api/items/${leche.id}`, ana, { price: 2.7, storeId: mercadona });   // vuelve
  });

  it("reenviar con la misma Idempotency-Key no duplica nada", async () => {
    const pan = await addItem("pan");
    const key = randomUUID();
    const send = () => call("PATCH", `/api/items/${pan.id}`, ana, { checked: true, price: 0.6, storeId: mercadona }, { "idempotency-key": key });
    expect((await send()).body.item).toBeDefined();
    expect((await send()).body).toEqual({ replayed: true });
    const rows = all(app.db, "SELECT COUNT(*) AS n FROM price_history h JOIN store_products sp ON sp.id = h.store_product_id WHERE sp.name = 'Pan'");
    expect(rows[0]!.n).toBe(1);
  });

  it("sin tienda el precio se queda en la línea pero no entra en el libro", async () => {
    const sal = await addItem("sal");
    await call("PATCH", `/api/items/${sal.id}`, ana, { checked: true, price: 0.5 });
    expect((await book()).some((e) => e.stem === "sal")).toBe(false);
    expect((await call("GET", `/api/lists/${listId}`, ana)).body.items.find((i: Json) => i.name === "Sal").price).toBe(0.5);
  });

  it("quitar el precio de la línea no borra lo aprendido", async () => {
    const leche = (await call("GET", `/api/lists/${listId}`, ana)).body.items.find((i: Json) => i.name === "Leche");
    const r = await call("PATCH", `/api/items/${leche.id}`, ana, { price: null });
    expect(r.body.item.price).toBeNull();
    expect((await book()).some((e) => e.stem === "leche" && e.storeId === mercadona)).toBe(true);
  });

  it("rechaza una tienda que no es del hogar o un precio negativo", async () => {
    const it = await addItem("aceite");
    expect((await call("PATCH", `/api/items/${it.id}`, ana, { price: 3, storeId: randomUUID() })).status).toBe(400);
    expect((await call("PATCH", `/api/items/${it.id}`, ana, { price: -1, storeId: mercadona })).status).toBe(400);
  });
});

describe("precio a mano desde la ficha", () => {
  it("apunta el precio por cantidad y unidad", async () => {
    const r = await call("PUT", "/api/prices/manual", ana, { name: "Aceite de oliva", storeId: familyCash, price: 8.4, qty: 2, unit: "l" });
    expect(r.status).toBe(200);
    expect(r.body.entry).toMatchObject({ stem: "aceite de oliva", unitPrice: 4.2, refUnit: "l", confirmed: true, source: "manual" });
  });

  it("actualizar el precio lo cambia y lo apunta en el historial", async () => {
    await call("PUT", "/api/prices/manual", ana, { name: "Aceite de oliva", storeId: familyCash, price: 9, qty: 2, unit: "l" });
    const pts = (await call("GET", `/api/prices/history?stem=${encodeURIComponent("aceite de oliva")}&storeId=${familyCash}`, ana)).body.points as Json[];
    expect(pts.map((p) => p.unitPrice)).toEqual([4.2, 4.5]);
  });

  it("borra el precio y lo deja fuera del libro", async () => {
    const del = await call("DELETE", `/api/prices/manual?stem=${encodeURIComponent("aceite de oliva")}&storeId=${familyCash}`, ana);
    expect(del.status).toBe(204);
    expect((await book()).some((e) => e.stem === "aceite de oliva")).toBe(false);
  });

  it("valida la entrada y la pertenencia de la tienda", async () => {
    expect((await call("PUT", "/api/prices/manual", ana, { name: "X", storeId: randomUUID(), price: 1 })).status).toBe(404);
    expect((await call("PUT", "/api/prices/manual", ana, { name: "", storeId: mercadona, price: 1 })).status).toBe(400);
    expect((await call("PUT", "/api/prices/manual", undefined, { name: "X", storeId: mercadona, price: 1 })).status).toBe(401);
  });

  it("una tienda eliminada ya no aparece en el libro", async () => {
    const tmp = (await call("POST", "/api/stores", ana, { name: "Temporal" })).body.store.id;
    await call("PUT", "/api/prices/manual", ana, { name: "Yogures", storeId: tmp, price: 1.5 });
    expect((await book()).some((e) => e.storeId === tmp)).toBe(true);
    await call("DELETE", `/api/stores/${tmp}`, ana);
    expect((await book()).some((e) => e.storeId === tmp)).toBe(false);
  });
});

describe("exportar incluye precios", () => {
  it("el JSON trae las tiendas, el libro y lo pagado", async () => {
    const r = await call("GET", "/api/export", ana);
    expect(r.body.stores.map((s: Json) => s.chain)).toContain("mercadona");
    expect(r.body.prices.some((p: Json) => p.product === "Leche" && p.store === "Mercadona" && p.confirmed)).toBe(true);
    expect(r.body.purchases.some((p: Json) => p.name === "Tomates" && p.paid === 2.99 && p.store === "Mercadona")).toBe(true);
  });
});
