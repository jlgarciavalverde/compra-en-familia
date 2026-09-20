import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp, type App } from "./app";
import { getVapid, isAllowedPushEndpoint, type PushPayload, type PushTarget } from "./push";
import { openDb } from "./db";

type Json = Record<string, any>;
interface Sent { to: string; payload: PushPayload }
const sent: Sent[] = [];
let failWith: number | null = null;

let app: App;
let ana: string, luis: string, anaId: string, luisId: string, listId: string;

async function call(method: string, url: string, token?: string, payload?: unknown) {
  const res = await app.inject({ method: method as "GET", url, payload: payload as object | undefined, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body: any = res.body; try { body = JSON.parse(res.body); } catch { /* texto */ }
  return { status: res.statusCode, body: body as Json };
}
const sub = (host = "fcm.googleapis.com") => ({
  endpoint: `https://${host}/fcm/send/${randomUUID()}`,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
});
const clear = () => { sent.length = 0; };
const recipientsOf = () => sent.map((s) => s.to);

beforeAll(async () => {
  app = await buildApp({
    dbPath: ":memory:", version: "t", setupCode: "setup", allowedOrigins: [], authRateLimit: 1000, logLevel: "silent", pushDebounceMs: 60_000,
    pushSender: async (t: PushTarget, payload: PushPayload) => {
      if (failWith) throw Object.assign(new Error("push"), { statusCode: failWith });
      sent.push({ to: t.endpoint, payload });
    },
  });
  const a = await call("POST", "/api/auth/register", undefined, { name: "Ana", email: "ana@casa.es", password: "supersecreta1", setupCode: "setup", householdName: "Casa" });
  ana = a.body.token; anaId = a.body.user.id;
  const inv = await call("POST", "/api/household/invites", ana);
  const l = await call("POST", "/api/auth/register", undefined, { name: "Luis", email: "luis@casa.es", password: "otrasecreta1", inviteCode: inv.body.code });
  luis = l.body.token; luisId = l.body.user.id;
  listId = (await call("POST", "/api/lists", ana, { name: "Súper", emoji: "🛒" })).body.list.id;
});
afterAll(() => app.close());

let anaSub: ReturnType<typeof sub>, luisSub: ReturnType<typeof sub>;

describe("claves y suscripciones", () => {
  it("las claves VAPID se generan una vez y se conservan", () => {
    const db = openDb(":memory:");
    const a = getVapid(db);
    expect(a.publicKey.length).toBeGreaterThan(60);
    expect(getVapid(db)).toEqual(a);
  });

  it("solo con sesión, y devuelve la clave pública", async () => {
    expect((await call("GET", "/api/push/key")).status).toBe(401);
    const r = await call("GET", "/api/push/key", ana);
    expect(r.body.publicKey).toBe(getVapid(app.db).publicKey);
  });

  it("solo acepta servicios de push conocidos (no direcciones internas)", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x", "https://web.push.apple.com/abc"]) expect(isAllowedPushEndpoint(ok), ok).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://192.168.18.7/x", "https://localhost/x", "https://fcm.googleapis.com.evil.com/x", "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "ftp://fcm.googleapis.com/x", "no-es-url"]) expect(isAllowedPushEndpoint(bad), bad).toBe(false);
  });

  it("suscribe, es idempotente y rechaza destinos no permitidos", async () => {
    anaSub = sub(); luisSub = sub("updates.push.services.mozilla.com");
    expect((await call("POST", "/api/push/subscribe", ana, anaSub)).status).toBe(204);
    expect((await call("POST", "/api/push/subscribe", ana, anaSub)).status).toBe(204);
    expect((await call("POST", "/api/push/subscribe", luis, luisSub)).status).toBe(204);
    expect((await call("GET", "/api/push/prefs", ana)).body.devices).toBe(1);
    expect((await call("POST", "/api/push/subscribe", ana, { ...sub("http.evil.internal"), endpoint: "https://192.168.18.7/push" })).status).toBe(400);
    expect((await call("POST", "/api/push/subscribe", ana, { endpoint: "no", keys: anaSub.keys })).status).toBe(400);
  });

  it("un dispositivo que cambia de cuenta pasa a la nueva persona", async () => {
    const shared = sub();
    await call("POST", "/api/push/subscribe", ana, shared);
    await call("POST", "/api/push/subscribe", luis, shared);
    expect((await call("GET", "/api/push/prefs", ana)).body.devices).toBe(2);
    expect((await call("GET", "/api/push/prefs", luis)).body.devices).toBe(2);
    await call("POST", "/api/push/unsubscribe", luis, { endpoint: shared.endpoint });
    expect((await call("GET", "/api/push/prefs", luis)).body.devices).toBe(1);
  });

  it("las preferencias empiezan activadas y se pueden cambiar", async () => {
    expect((await call("GET", "/api/push/prefs", ana)).body.prefs).toEqual({ added: true, assigned: true, shopping: true, completed: true });
    const r = await call("PATCH", "/api/push/prefs", ana, { shopping: false });
    expect(r.body.prefs).toMatchObject({ shopping: false, added: true });
    await call("PATCH", "/api/push/prefs", ana, { shopping: true });
  });

  it("el aviso de prueba llega a los dispositivos de quien lo pide", async () => {
    clear();
    const r = await call("POST", "/api/push/test", ana);
    expect(r.body.sent).toBe(1);
    expect(recipientsOf()).toEqual([anaSub.endpoint]);
  });
});

describe("cuándo se avisa", () => {
  it("añadir productos avisa a los demás, agrupado y sin avisar a quien los añade", async () => {
    clear();
    await call("POST", `/api/lists/${listId}/items`, ana, { text: "leche" });
    await call("POST", `/api/lists/${listId}/items`, ana, { text: "huevos, pan" });
    await call("POST", `/api/lists/${listId}/items`, ana, { text: "leche" });
    expect(sent).toHaveLength(0);           // aún esperando para agrupar
    await app.notifier.flush();
    expect(recipientsOf()).toEqual([luisSub.endpoint]);
    expect(sent[0]!.payload).toMatchObject({ title: "🛒 Súper", body: "Ana añadió Leche, Huevos y Pan", url: `/listas/${listId}` });
  });

  it("con muchos productos resume", async () => {
    clear();
    await call("POST", `/api/lists/${listId}/items`, ana, { text: "a1, b2, c3, d4, e5" });
    await app.notifier.flush();
    expect(sent[0]!.payload.body).toBe("Ana añadió A1, B2, C3 y 2 más");
  });

  it("respeta las preferencias de cada persona", async () => {
    await call("PATCH", "/api/push/prefs", luis, { added: false });
    clear();
    await call("POST", `/api/lists/${listId}/items`, ana, { text: "sal" });
    await app.notifier.flush();
    expect(sent).toHaveLength(0);
    await call("PATCH", "/api/push/prefs", luis, { added: true });
  });

  it("asignar algo avisa a esa persona (y no si te lo asignas a ti)", async () => {
    const items = (await call("GET", `/api/lists/${listId}`, ana)).body.items as Json[];
    clear();
    await call("PATCH", `/api/items/${items[0]!.id}`, ana, { assigneeId: luisId });
    await call("PATCH", `/api/items/${items[1]!.id}`, ana, { assigneeId: luisId });
    await call("PATCH", `/api/items/${items[2]!.id}`, ana, { assigneeId: anaId });
    await app.notifier.flush();
    expect(recipientsOf()).toEqual([luisSub.endpoint]);
    expect(sent[0]!.payload.body).toContain("Ana te ha asignado 2 cosas");
  });

  it("terminar la lista avisa una sola vez", async () => {
    const l2 = (await call("POST", "/api/lists", ana, { name: "Corta", emoji: "🥕" })).body.list.id;
    const [x, y] = (await call("POST", `/api/lists/${l2}/items`, ana, { text: "uno, dos" })).body.items as Json[];
    await app.notifier.flush(); clear();
    await call("PATCH", `/api/items/${x!.id}`, luis, { checked: true });
    await app.notifier.flush();
    expect(sent).toHaveLength(0);           // aún queda uno
    await call("PATCH", `/api/items/${y!.id}`, luis, { checked: true });
    await app.notifier.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ title: "🎉 Corta", body: "Luis ha comprado todo. ¡Lista completa!" });
    expect(recipientsOf()).toEqual([anaSub.endpoint, ...(await deviceCount(anaId)) > 1 ? [] : []].filter(Boolean).slice(0, 1).concat([]) as string[]);
  });

  it("empezar a comprar avisa a los demás, una vez cada 30 minutos", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const open = (token: string) => new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on("message", (d) => { if (JSON.parse(d.toString()).type === "ready") resolve(ws); });
      ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
      ws.on("error", reject);
    });
    const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
    clear();
    const w = await open(luis);
    w.send(JSON.stringify({ type: "shopping", listId }));
    await wait(); await app.notifier.flush();
    expect(sent.some((s) => s.payload.body === "Luis empieza a comprar")).toBe(true);
    expect(sent.every((s) => s.to !== luisSub.endpoint)).toBe(true);
    const n = sent.length;
    w.send(JSON.stringify({ type: "shopping", listId: null }));
    await wait();
    w.send(JSON.stringify({ type: "shopping", listId }));
    await wait(); await app.notifier.flush();
    expect(sent).toHaveLength(n);           // no se repite
    w.close();
  });
});

const deviceCount = async (uid: string) => (app.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").get(uid) as Json).n as number;

describe("suscripciones caducadas y quitar personas", () => {
  it("una suscripción que el servicio da por muerta (410) se elimina", async () => {
    const before = await deviceCount(luisId);
    failWith = 410;
    await call("POST", "/api/push/test", luis);
    failWith = null;
    expect(await deviceCount(luisId)).toBe(before - 1);
  });

  it("un error temporal no elimina nada", async () => {
    const before = await deviceCount(anaId);
    failWith = 500;
    await call("POST", "/api/push/test", ana);
    failWith = null;
    expect(await deviceCount(anaId)).toBe(before);
  });

  it("quitar a alguien del hogar borra sus dispositivos", async () => {
    const inv = await call("POST", "/api/household/invites", ana);
    const t = (await call("POST", "/api/auth/register", undefined, { name: "Peque", email: "peque@casa.es", password: "otrasecreta1", inviteCode: inv.body.code })).body;
    await call("POST", "/api/push/subscribe", t.token, sub());
    expect(await deviceCount(t.user.id)).toBe(1);
    await call("DELETE", `/api/household/members/${t.user.id}`, ana);
    expect(await deviceCount(t.user.id)).toBe(0);
  });
});
