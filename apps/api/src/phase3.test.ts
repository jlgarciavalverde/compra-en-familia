import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp, type App } from "./app";
import { stem } from "@compra/shared";
import { run } from "./db";

let app: App;
let ana: string;
let luis: string;
let luisId: string;
let anaId: string;
let cats: Record<string, string>;
let listId: string;

type Json = Record<string, any>;
async function call(method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: method as "GET", url, payload: payload as object | undefined,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  let body: any = res.body;
  try { body = JSON.parse(res.body); } catch { /* texto */ }
  return { status: res.statusCode, body: body as Json, raw: res.body, headers: res.headers };
}

beforeAll(async () => {
  app = await buildApp({ dbPath: ":memory:", version: "t", setupCode: "setup", allowedOrigins: [], logLevel: "silent" });
  const a = await call("POST", "/api/auth/register", undefined, { name: "Ana", email: "ana@casa.es", password: "supersecreta1", setupCode: "setup", householdName: "Casa" });
  ana = a.body.token; anaId = a.body.user.id;
  const inv = await call("POST", "/api/household/invites", ana);
  const l = await call("POST", "/api/auth/register", undefined, { name: "Luis", email: "luis@casa.es", password: "otrasecreta1", inviteCode: inv.body.code });
  luis = l.body.token; luisId = l.body.user.id;
  cats = Object.fromEntries((await call("GET", "/api/categories", ana)).body.categories.map((c: Json) => [c.key, c.id]));
  listId = (await call("POST", "/api/lists", ana, { name: "Súper" })).body.list.id;
});
afterAll(() => app.close());

const addItems = (token: string, text: string, id = listId) => call("POST", `/api/lists/${id}/items`, token, { text });
const detail = async (id = listId) => (await call("GET", `/api/lists/${id}`, ana)).body;

describe("orden manual", () => {
  it("los productos nuevos quedan en el orden en que se añaden", async () => {
    await addItems(ana, "uno, dos, tres");
    expect((await detail()).items.map((i: Json) => i.name)).toEqual(["Uno", "Dos", "Tres"]);
  });

  it("mover un producto cambia su posición y persiste", async () => {
    const items = (await detail()).items as Json[];
    const tres = items.find((i) => i.name === "Tres")!;
    const uno = items.find((i) => i.name === "Uno")!;
    const r = await call("PATCH", `/api/items/${tres.id}`, ana, { position: uno.position - 1 });
    expect(r.body.item.position).toBe(uno.position - 1);
    expect((await detail()).items.map((i: Json) => i.name)).toEqual(["Tres", "Uno", "Dos"]);
  });
});

describe("plantillas", () => {
  let templateId: string;
  it("guarda una lista como plantilla sin marcarla ni asignarla", async () => {
    const items = (await detail()).items as Json[];
    await call("PATCH", `/api/items/${items[0]!.id}`, ana, { checked: true, assigneeId: luisId });
    const r = await call("POST", `/api/lists/${listId}/duplicate`, ana, { template: true });
    expect(r.status).toBe(201);
    expect(r.body.list).toMatchObject({ name: "Súper", template: true, total: 3, checked: 0 });
    templateId = r.body.list.id;
    const copy = (await detail(templateId)).items as Json[];
    expect(copy.every((i) => i.checkedAt === null && i.assigneeId === null)).toBe(true);
    expect(copy.map((i) => i.name)).toEqual(items.map((i) => i.name)); // mismo orden
  });

  it("las plantillas no salen entre las listas normales, sino en su propio listado", async () => {
    const normal = (await call("GET", "/api/lists", ana)).body.lists as Json[];
    expect(normal.map((l) => l.id)).not.toContain(templateId);
    const tpl = (await call("GET", "/api/lists?template=1", ana)).body.lists as Json[];
    expect(tpl.map((l) => l.id)).toEqual([templateId]);
  });

  it("usar una plantilla crea una lista normal con el mismo nombre", async () => {
    const r = await call("POST", `/api/lists/${templateId}/duplicate`, ana, {});
    expect(r.body.list).toMatchObject({ name: "Súper", template: false, total: 3 });
    expect((await call("GET", "/api/lists", ana)).body.lists.map((l: Json) => l.id)).toContain(r.body.list.id);
  });
});

describe("historial y sugerencias", () => {
  it("marcar apunta la compra y desmarcar la quita", async () => {
    const l = (await call("POST", "/api/lists", ana, { name: "Historial" })).body.list.id;
    const it = (await addItems(ana, "leche", l)).body.items[0];
    await call("PATCH", `/api/items/${it.id}`, luis, { checked: true });
    let h = (await call("GET", "/api/history", ana)).body;
    expect(h.purchases[0]).toMatchObject({ name: "Leche", listName: "Historial", userId: luisId });
    await call("PATCH", `/api/items/${it.id}`, luis, { checked: false });
    h = (await call("GET", "/api/history", ana)).body;
    expect(h.purchases.find((p: Json) => p.name === "Leche")).toBeUndefined();
    // Vuelve a marcarse y "vaciar comprados" no borra el historial.
    await call("PATCH", `/api/items/${it.id}`, luis, { checked: true });
    await call("POST", `/api/lists/${l}/clear-checked`, luis);
    expect((await call("GET", "/api/history", ana)).body.purchases.some((p: Json) => p.name === "Leche")).toBe(true);
  });

  it("pagina hacia atrás", async () => {
    for (let i = 0; i < 5; i++) {
      run(app.db, "INSERT INTO purchases (id, household_id, list_id, list_name, name, stem, category_id, qty, unit, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        randomUUID(), (await call("GET", "/api/me", ana)).body.household.id, null, "Vieja", `Prod ${i}`, `prod ${i}`, cats.otros!, 1, null, anaId, 1000 + i);
    }
    const p1 = (await call("GET", "/api/history?limit=3", ana)).body;
    expect(p1.purchases).toHaveLength(3);
    expect(p1.hasMore).toBe(true);
    const p2 = (await call("GET", `/api/history?limit=3&before=${p1.purchases.at(-1).at}`, ana)).body;
    expect(p2.purchases.every((p: Json) => p.at < p1.purchases.at(-1).at)).toBe(true);
  });

  const DAY = 24 * 3600 * 1000;
  const seed = (name: string, daysAgo: number[]) => {
    const hid = (app.db.prepare("SELECT id FROM households").get() as Json).id;
    for (const d of daysAgo) {
      run(app.db, "INSERT INTO purchases (id, household_id, list_id, list_name, name, stem, category_id, qty, unit, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        randomUUID(), hid, null, "Súper", name, stem(name), cats.lacteos!, 1, null, anaId, Date.now() - d * DAY);
    }
  };

  it("sugiere lo que suele faltar y ya toca", async () => {
    seed("Yogures", [30, 23, 16, 9]);   // cada 7 días, hace 9: toca
    seed("Café", [40, 20]);              // cada 20 días, hace 20: toca
    seed("Sal", [50, 9]);                // cada 41 días, hace 9: aún no
    seed("Azafrán", [400 / 4]);          // una sola compra: no hay patrón
    const s = (await call("GET", "/api/suggestions", ana)).body.suggestions as Json[];
    const names = s.map((x) => x.name);
    expect(names).toContain("Yogures");
    expect(names).toContain("Café");
    expect(names).not.toContain("Sal");
    expect(names).not.toContain("Azafrán");
    expect(s.find((x) => x.name === "Yogures")).toMatchObject({ everyDays: 7, daysSince: 9, categoryId: cats.lacteos });
  });

  it("no sugiere lo que ya está pendiente en una lista", async () => {
    await addItems(ana, "yogures");
    const names = ((await call("GET", "/api/suggestions", ana)).body.suggestions as Json[]).map((x) => x.name);
    expect(names).not.toContain("Yogures");
    expect(names).toContain("Café");
  });
});

describe("tiendas y orden de pasillos", () => {
  let storeId: string;
  it("crea una tienda con orden por defecto (todas las categorías)", async () => {
    const r = await call("POST", "/api/stores", ana, { name: "Mercadona" });
    expect(r.status).toBe(201);
    storeId = r.body.store.id;
    expect(r.body.store.order).toHaveLength(12);
    expect(r.body.store.order[0]).toBe(cats["frutas-verduras"]);
  });

  it("guarda un orden parcial y completa el resto al final", async () => {
    const r = await call("PATCH", `/api/stores/${storeId}`, ana, { order: [cats.lacteos, cats.panaderia] });
    expect(r.body.store.order.slice(0, 2)).toEqual([cats.lacteos, cats.panaderia]);
    expect(r.body.store.order).toHaveLength(12);
    expect(new Set(r.body.store.order).size).toBe(12);
  });

  it("rechaza categorías ajenas o repetidas", async () => {
    expect((await call("PATCH", `/api/stores/${storeId}`, ana, { order: [randomUUID()] })).status).toBe(400);
    expect((await call("PATCH", `/api/stores/${storeId}`, ana, { order: [cats.lacteos, cats.lacteos] })).status).toBe(400);
  });

  it("lista, renombra y elimina", async () => {
    await call("PATCH", `/api/stores/${storeId}`, luis, { name: "Mercadona Centro" });
    expect((await call("GET", "/api/stores", ana)).body.stores.map((s: Json) => s.name)).toEqual(["Mercadona Centro"]);
    expect((await call("DELETE", `/api/stores/${storeId}`, luis)).status).toBe(204);
    expect((await call("GET", "/api/stores", ana)).body.stores).toEqual([]);
    expect((await call("PATCH", `/api/stores/${storeId}`, ana, { name: "X" })).status).toBe(404);
  });
});

describe("exportar", () => {
  it("JSON con todo el hogar", async () => {
    const r = await call("GET", "/api/export", ana);
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="compra-en-familia-\d{4}-\d{2}-\d{2}\.json"/);
    expect(r.body.household.name).toBe("Casa");
    expect(r.body.members.map((m: Json) => m.name)).toEqual(["Ana", "Luis"]);
    expect(r.body.lists.find((l: Json) => l.name === "Súper").items.length).toBeGreaterThan(0);
    expect(r.body.purchases.length).toBeGreaterThan(0);
  });

  it("CSV con tildes, comas y comillas bien escapadas", async () => {
    await call("POST", "/api/lists", ana, { name: 'Fiesta, "grande"' }).then((r) => addItems(ana, "globos", r.body.list.id));
    const r = await call("GET", "/api/export?format=csv", ana);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.raw.startsWith("﻿lista,plantilla,archivada,pasillo,producto")).toBe(true);
    expect(r.raw).toContain('"Fiesta, ""grande"""');
    expect((await call("GET", "/api/export", undefined)).status).toBe(401);
  });
});

describe("presencia: quién está comprando", () => {
  it("avisa a los demás y se limpia al desconectar", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const open = (token: string) => new Promise<{ ws: WebSocket; msgs: Json[] }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const msgs: Json[] = [];
      ws.on("message", (d) => { const m = JSON.parse(d.toString()); msgs.push(m); if (m.type === "presence" && msgs.length === 2) resolve({ ws, msgs }); });
      ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
      ws.on("error", reject);
    });
    const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

    const a = await open(ana);
    const l = await open(luis);
    expect(l.msgs.at(-1)).toEqual({ type: "presence", shopping: [] });

    a.ws.send(JSON.stringify({ type: "shopping", listId }));
    await wait();
    expect(l.msgs.at(-1)).toEqual({ type: "presence", shopping: [{ userId: anaId, listId }] });

    // Una lista que no es del hogar se ignora.
    l.ws.send(JSON.stringify({ type: "shopping", listId: randomUUID() }));
    await wait();
    expect(l.msgs.at(-1)!.shopping).toHaveLength(1);

    // Quien se conecta después ya recibe el estado actual.
    const late = await open(luis);
    expect(late.msgs.at(-1)).toEqual({ type: "presence", shopping: [{ userId: anaId, listId }] });
    late.ws.close();

    a.ws.close();
    await wait(200);
    expect(l.msgs.at(-1)).toEqual({ type: "presence", shopping: [] });
    l.ws.close();
  });
});

describe("quitar miembros", () => {
  it("solo un admin, y no a sí mismo", async () => {
    expect((await call("DELETE", `/api/household/members/${anaId}`, luis)).status).toBe(403);
    expect((await call("DELETE", `/api/household/members/${anaId}`, ana)).status).toBe(400);
    expect((await call("DELETE", `/api/household/members/${randomUUID()}`, ana)).status).toBe(404);
  });

  it("la persona quitada pierde el acceso, se le libera el email y su historial se conserva", async () => {
    const extra = await call("POST", "/api/household/invites", ana);
    const t = (await call("POST", "/api/auth/register", undefined, { name: "Peque", email: "peque@casa.es", password: "otrasecreta1", inviteCode: extra.body.code })).body;
    await addItems(ana, "chuches").then((r) => call("PATCH", `/api/items/${r.body.items[0].id}`, ana, { assigneeId: t.user.id, checked: true }));

    expect((await call("GET", "/api/me", t.token)).status).toBe(200);
    expect((await call("DELETE", `/api/household/members/${t.user.id}`, ana)).status).toBe(204);

    expect((await call("GET", "/api/me", t.token)).status).toBe(401);
    expect((await call("POST", "/api/auth/login", undefined, { email: "peque@casa.es", password: "otrasecreta1" })).status).toBe(401);
    expect((await call("GET", "/api/me", ana)).body.household.members.map((m: Json) => m.name)).toEqual(["Ana", "Luis"]);
    // Ya no se le puede asignar nada, y lo asignado queda libre.
    const chuches = (await detail()).items.find((i: Json) => i.name === "Chuches");
    expect(chuches.assigneeId).toBeNull();
    expect((await call("PATCH", `/api/items/${chuches.id}`, ana, { assigneeId: t.user.id })).status).toBe(400);
    // El email queda disponible para volver a invitar a la misma persona.
    const again = await call("POST", "/api/household/invites", ana);
    expect((await call("POST", "/api/auth/register", undefined, { name: "Peque", email: "peque@casa.es", password: "otrasecreta1", inviteCode: again.body.code })).status).toBe(201);
    // Su compra sigue en el historial.
    expect((await call("GET", "/api/history", ana)).body.purchases.some((p: Json) => p.name === "Chuches")).toBe(true);
  });
});
