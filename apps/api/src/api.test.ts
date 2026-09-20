import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "./app";
import { run } from "./db";
import { seedHousehold, CATALOG_SIZE } from "./seed";

const SETUP = "codigo-de-prueba";
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ dbPath: ":memory:", version: "test", setupCode: SETUP, allowedOrigins: [], logLevel: "silent" });
});
afterAll(() => app.close());

type Json = Record<string, any>;
async function call(method: string, url: string, token?: string, payload?: unknown) {
  const res = await app.inject({
    method: method as "GET",
    url,
    payload: payload as object | undefined,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.statusCode, body: (res.body ? safeJson(res.body) : null) as Json };
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

const ana = { name: "Ana", email: "ana@casa.es", password: "supersecreta1" };
let tokenAna: string;
let tokenLuis: string;
let luisId: string;
let cats: Record<string, string>;
let listId: string;

describe("cuentas y hogar", () => {
  it("el catálogo semilla es amplio", () => expect(CATALOG_SIZE).toBeGreaterThan(200));

  it("al principio necesita configuración", async () => {
    expect((await call("GET", "/api/setup-status")).body.needsSetup).toBe(true);
  });

  it("no se puede crear el hogar sin el código de configuración", async () => {
    const r = await call("POST", "/api/auth/register", undefined, { ...ana, setupCode: "mal" });
    expect(r.status).toBe(403);
  });

  it("crea el hogar con el código y la primera persona es admin", async () => {
    const r = await call("POST", "/api/auth/register", undefined, { ...ana, setupCode: SETUP, householdName: "Casa García" });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe("admin");
    tokenAna = r.body.token;
    expect((await call("GET", "/api/setup-status")).body.needsSetup).toBe(false);
  });

  it("después el registro público queda cerrado", async () => {
    const r = await call("POST", "/api/auth/register", undefined, { name: "Intruso", email: "x@x.es", password: "12345678", setupCode: SETUP });
    expect(r.status).toBe(403);
  });

  it("login correcto e incorrecto", async () => {
    expect((await call("POST", "/api/auth/login", undefined, { email: "ANA@casa.es", password: ana.password })).status).toBe(200);
    expect((await call("POST", "/api/auth/login", undefined, { email: ana.email, password: "otra-cosa" })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", undefined, { email: "nadie@casa.es", password: "otra-cosa" })).status).toBe(401);
  });

  it("las rutas privadas exigen sesión", async () => {
    expect((await call("GET", "/api/lists")).status).toBe(401);
    expect((await call("GET", "/api/lists", "token-falso")).status).toBe(401);
  });

  it("una invitación sirve una sola vez", async () => {
    const inv = await call("POST", "/api/household/invites", tokenAna);
    expect(inv.status).toBe(201);
    const code: string = inv.body.code;
    expect((await call("GET", `/api/invites/${code}`)).body).toEqual({ valid: true, householdName: "Casa García" });

    const r = await call("POST", "/api/auth/register", undefined, { name: "Luis", email: "luis@casa.es", password: "otrasecreta1", inviteCode: code.toLowerCase() });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe("member");
    tokenLuis = r.body.token;
    luisId = r.body.user.id;

    expect((await call("GET", `/api/invites/${code}`)).body.valid).toBe(false);
    const again = await call("POST", "/api/auth/register", undefined, { name: "Otro", email: "otro@casa.es", password: "otrasecreta1", inviteCode: code });
    expect(again.status).toBe(400);
  });

  it("solo los admin invitan", async () => {
    expect((await call("POST", "/api/household/invites", tokenLuis)).status).toBe(403);
  });

  it("el hogar lista a sus miembros", async () => {
    const r = await call("GET", "/api/me", tokenLuis);
    expect(r.body.household.members.map((m: Json) => m.name)).toEqual(["Ana", "Luis"]);
  });

  it("logout invalida la sesión", async () => {
    const t = (await call("POST", "/api/auth/login", undefined, { email: ana.email, password: ana.password })).body.token;
    expect((await call("POST", "/api/auth/logout", t)).status).toBe(204);
    expect((await call("GET", "/api/me", t)).status).toBe(401);
  });
});

describe("catálogo", () => {
  it("devuelve las 12 categorías", async () => {
    const r = await call("GET", "/api/categories", tokenAna);
    expect(r.body.categories).toHaveLength(12);
    cats = Object.fromEntries(r.body.categories.map((c: Json) => [c.key, c.id]));
  });

  it("autocompleta sin acentos ni mayúsculas y ordena por prefijo", async () => {
    const r = await call("GET", `/api/products/suggest?q=${encodeURIComponent("LIMÓ")}`, tokenAna);
    expect(r.body.suggestions[0].name).toBe("Limones");
    const r2 = await call("GET", "/api/products/suggest?q=leche", tokenAna);
    expect(r2.body.suggestions[0].name.startsWith("Leche")).toBe(true);
    expect(r2.body.suggestions.every((s: Json) => s.categoryId === cats.lacteos)).toBe(true);
  });

  it("encuentra por plural o singular", async () => {
    const r = await call("GET", "/api/products/suggest?q=manzana", tokenAna);
    expect(r.body.suggestions.map((s: Json) => s.name)).toContain("Manzanas");
  });
});

describe("listas e ítems", () => {
  it("crea y lista listas", async () => {
    const r = await call("POST", "/api/lists", tokenAna, { name: "Súper semanal", emoji: "🛒" });
    expect(r.status).toBe(201);
    listId = r.body.list.id;
    const l = await call("GET", "/api/lists", tokenLuis);
    expect(l.body.lists.map((x: Json) => x.name)).toEqual(["Súper semanal"]);
  });

  it("añade varios productos de golpe y los categoriza solos", async () => {
    const r = await call("POST", `/api/lists/${listId}/items`, tokenAna, { text: "leche, huevos x12, 2 kg de tomates, pan, cosa rara" });
    expect(r.status).toBe(201);
    const byName = Object.fromEntries(r.body.items.map((i: Json) => [i.name, i]));
    expect(byName["Leche"].categoryId).toBe(cats.lacteos);
    expect(byName["Huevos"]).toMatchObject({ qty: 12, categoryId: cats.lacteos });
    expect(byName["Tomates"]).toMatchObject({ qty: 2, unit: "kg", categoryId: cats["frutas-verduras"] });
    expect(byName["Pan"].categoryId).toBe(cats.panaderia);
    expect(byName["Cosa rara"].categoryId).toBe(cats.otros);
  });

  it("suma la cantidad si el producto ya está pendiente (singular/plural)", async () => {
    await call("POST", `/api/lists/${listId}/items`, tokenLuis, { text: "Huevo x6" });
    const d = await call("GET", `/api/lists/${listId}`, tokenAna);
    const huevos = d.body.items.filter((i: Json) => i.name === "Huevos");
    expect(huevos).toHaveLength(1);
    expect(huevos[0].qty).toBe(18);
  });

  it("aprende productos nuevos para el autocompletado", async () => {
    const r = await call("GET", "/api/products/suggest?q=cosa", tokenAna);
    expect(r.body.suggestions[0].name).toBe("Cosa rara");
  });

  it("marca, asigna, edita y cambia de categoría", async () => {
    const items = (await call("GET", `/api/lists/${listId}`, tokenAna)).body.items as Json[];
    const leche = items.find((i) => i.name === "Leche")!;
    const r = await call("PATCH", `/api/items/${leche.id}`, tokenLuis, { checked: true, assigneeId: luisId, qty: 3, unit: "l", note: "sin lactosa" });
    expect(r.body.item).toMatchObject({ qty: 3, unit: "l", assigneeId: luisId, note: "sin lactosa" });
    expect(r.body.item.checkedAt).toBeTypeOf("number");
    expect((await call("PATCH", `/api/items/${leche.id}`, tokenLuis, { checked: false })).body.item.checkedAt).toBeNull();

    const rara = items.find((i) => i.name === "Cosa rara")!;
    await call("PATCH", `/api/items/${rara.id}`, tokenAna, { categoryId: cats.despensa });
    // Y la próxima vez que se añada, ya cae en la categoría corregida.
    await call("DELETE", `/api/items/${rara.id}`, tokenAna);
    const again = await call("POST", `/api/lists/${listId}/items`, tokenAna, { text: "cosa rara" });
    expect(again.body.items[0].categoryId).toBe(cats.despensa);
  });

  it("rechaza asignar a alguien de fuera o categorías ajenas", async () => {
    const items = (await call("GET", `/api/lists/${listId}`, tokenAna)).body.items as Json[];
    expect((await call("PATCH", `/api/items/${items[0]!.id}`, tokenAna, { assigneeId: randomUUID() })).status).toBe(400);
    expect((await call("PATCH", `/api/items/${items[0]!.id}`, tokenAna, { categoryId: randomUUID() })).status).toBe(400);
  });

  it("borrar comprados y deshacer", async () => {
    const items = (await call("GET", `/api/lists/${listId}`, tokenAna)).body.items as Json[];
    for (const it of items.slice(0, 2)) await call("PATCH", `/api/items/${it.id}`, tokenAna, { checked: true });
    const before = (await call("GET", "/api/lists", tokenAna)).body.lists[0];
    expect(before.checked).toBe(2);

    const cleared = await call("POST", `/api/lists/${listId}/clear-checked`, tokenAna);
    expect(cleared.body.ids).toHaveLength(2);
    expect((await call("GET", `/api/lists/${listId}`, tokenAna)).body.items).toHaveLength(items.length - 2);

    await call("POST", "/api/items/restore", tokenAna, { ids: cleared.body.ids });
    expect((await call("GET", `/api/lists/${listId}`, tokenAna)).body.items).toHaveLength(items.length);
  });

  it("archiva y duplica", async () => {
    const dup = await call("POST", `/api/lists/${listId}/duplicate`, tokenAna);
    expect(dup.body.list.name).toBe("Súper semanal (copia)");
    expect(dup.body.list.total).toBeGreaterThan(0);
    expect(dup.body.list.checked).toBe(0);

    await call("PATCH", `/api/lists/${dup.body.list.id}`, tokenAna, { archived: true });
    expect((await call("GET", "/api/lists", tokenAna)).body.lists).toHaveLength(1);
    expect((await call("GET", "/api/lists?archived=1", tokenAna)).body.lists).toHaveLength(1);
    await call("DELETE", `/api/lists/${dup.body.list.id}`, tokenAna);
    expect((await call("GET", "/api/lists?archived=1", tokenAna)).body.lists).toHaveLength(0);
  });

  it("valida la entrada", async () => {
    expect((await call("POST", "/api/lists", tokenAna, { name: "" })).status).toBe(400);
    expect((await call("POST", `/api/lists/${listId}/items`, tokenAna, {})).status).toBe(400);
    expect((await call("POST", `/api/lists/${listId}/items`, tokenAna, { text: "," })).status).toBe(400);
  });
});

describe("aislamiento entre hogares", () => {
  it("otro hogar no ve ni toca nada", async () => {
    const hid = randomUUID();
    const uid = randomUUID();
    run(app.db, "INSERT INTO households (id, name, created_at) VALUES (?,?,?)", hid, "Otra casa", Date.now());
    seedHousehold(app.db, hid);
    run(app.db, "INSERT INTO users (id, household_id, email, name, password_hash, role, avatar_color, avatar_emoji, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      uid, hid, "vecino@otra.es", "Vecino", "x", "admin", "#000000", "🍎", Date.now());
    const { createSession } = await import("./auth");
    const tokenVecino = createSession(app.db, uid);

    expect((await call("GET", "/api/lists", tokenVecino)).body.lists).toHaveLength(0);
    expect((await call("GET", `/api/lists/${listId}`, tokenVecino)).status).toBe(404);
    expect((await call("POST", `/api/lists/${listId}/items`, tokenVecino, { text: "pan" })).status).toBe(404);
    const items = (await call("GET", `/api/lists/${listId}`, tokenAna)).body.items as Json[];
    expect((await call("PATCH", `/api/items/${items[0]!.id}`, tokenVecino, { checked: true })).status).toBe(404);
    expect((await call("DELETE", `/api/lists/${listId}`, tokenVecino)).status).toBe(404);
  });
});

describe("tiempo real", () => {
  it("avisa a los demás dispositivos del hogar cuando algo cambia", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;

    const open = (token: string) =>
      new Promise<{ ws: WebSocket; messages: Json[] }>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const messages: Json[] = [];
        ws.on("message", (d) => {
          const m = JSON.parse(d.toString());
          messages.push(m);
          if (m.type === "ready") resolve({ ws, messages });
        });
        ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
        ws.on("error", reject);
        ws.on("close", (code) => code === 4401 && reject(new Error("unauthorized")));
      });

    const luis = await open(tokenLuis);
    await call("POST", `/api/lists/${listId}/items`, tokenAna, { text: "sal" });
    await new Promise((r) => setTimeout(r, 100));
    expect(luis.messages).toContainEqual({ type: "changed", listId });
    luis.ws.close();

    await expect(open("token-falso")).rejects.toThrow("unauthorized");
  });
});

describe("soporte offline: ids de cliente e idempotencia", () => {
  const post = (url: string, token: string, payload: unknown, key?: string) =>
    app.inject({ method: "POST", url, payload: payload as object, headers: { authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}) } });

  it("crea una lista con id de cliente y el reenvío no la duplica", async () => {
    const id = randomUUID();
    const a = await post("/api/lists", tokenAna, { id, name: "Creada sin red", emoji: "📵" }, randomUUID());
    expect(a.statusCode).toBe(201);
    expect(a.json().list.id).toBe(id);
    // Mismo id sin clave de idempotencia: devuelve la existente en vez de fallar.
    const b = await post("/api/lists", tokenAna, { id, name: "Creada sin red" });
    expect(b.statusCode).toBe(200);
    const all = (await call("GET", "/api/lists", tokenAna)).body.lists.filter((l: Json) => l.name === "Creada sin red");
    expect(all).toHaveLength(1);
  });

  it("añade ítems estructurados con su id y categoría", async () => {
    const id = randomUUID();
    const r = await post(`/api/lists/${listId}/items`, tokenAna, {
      items: [{ id, name: "yogur natural", qty: 4, unit: null, categoryId: cats.lacteos, assigneeId: luisId, note: "sin azúcar" }],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().items[0]).toMatchObject({ id, name: "Yogur natural", qty: 4, categoryId: cats.lacteos, assigneeId: luisId, note: "sin azúcar" });
    // Reenviar el mismo id no crea otro ni suma cantidad.
    await post(`/api/lists/${listId}/items`, tokenAna, { items: [{ id, name: "yogur natural", qty: 4 }] });
    const items = (await call("GET", `/api/lists/${listId}`, tokenAna)).body.items as Json[];
    expect(items.filter((i) => i.name === "Yogur natural")).toHaveLength(1);
    expect(items.find((i) => i.id === id)!.qty).toBe(4);
  });

  it("la misma Idempotency-Key no aplica dos veces una suma", async () => {
    const key = randomUUID();
    const body = { items: [{ id: randomUUID(), name: "Yogur natural", qty: 2 }] };
    const first = await post(`/api/lists/${listId}/items`, tokenAna, body, key);
    expect(first.statusCode).toBe(201);
    const replay = await post(`/api/lists/${listId}/items`, tokenAna, body, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ replayed: true });
    const yogur = ((await call("GET", `/api/lists/${listId}`, tokenAna)).body.items as Json[]).find((i) => i.name === "Yogur natural")!;
    expect(yogur.qty).toBe(6); // 4 + 2, no 4 + 2 + 2
  });

  it("una clave de otra persona no se comparte", async () => {
    const key = randomUUID();
    await post("/api/lists", tokenAna, { name: "A" }, key);
    const other = await post("/api/lists", tokenLuis, { name: "B" }, key);
    expect(other.statusCode).toBe(201);
  });

  it("un id de cliente fusionado sigue resolviéndose para cambios posteriores", async () => {
    const localId = randomUUID();
    const r = await post(`/api/lists/${listId}/items`, tokenLuis, { items: [{ id: localId, name: "yogur natural", qty: 1 }] });
    expect(r.json().items[0].id).not.toBe(localId); // se fusionó con el existente
    const patch = await call("PATCH", `/api/items/${localId}`, tokenLuis, { checked: true });
    expect(patch.status).toBe(200);
    expect(patch.body.item.name).toBe("Yogur natural");
    expect(patch.body.item.checkedAt).toBeTypeOf("number");
  });

  it("valida categorías y personas en la forma estructurada", async () => {
    const r = await post(`/api/lists/${listId}/items`, tokenAna, { items: [{ name: "Sal", categoryId: randomUUID() }] });
    expect(r.statusCode).toBe(400);
  });

  it("el catálogo completo llega con categorías y uso", async () => {
    const r = await call("GET", "/api/catalog", tokenAna);
    expect(r.status).toBe(200);
    expect(r.body.products.length).toBeGreaterThan(200);
    const yogur = r.body.products.find((p: Json) => p.name === "Yogur natural");
    expect(yogur).toMatchObject({ categoryId: cats.lacteos });
    expect(yogur.useCount).toBeGreaterThan(0);
    expect((await call("GET", "/api/catalog")).status).toBe(401);
  });
});
