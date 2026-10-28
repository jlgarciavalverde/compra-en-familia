import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app";
import { run } from "./db";

let app: App;
let ana: string;
let luis: string;
let luisId: string;
let anaId: string;

type Json = Record<string, any>;
async function call(method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: method as "GET", url, payload: payload as object | undefined,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  let body: any = res.body;
  try { body = JSON.parse(res.body); } catch { /* texto */ }
  return { status: res.statusCode, body: body as Json, headers: res.headers };
}
const login = async (email: string, password: string, ua = "Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36") =>
  call("POST", "/api/auth/login", undefined, { email, password }, { "user-agent": ua });

beforeAll(async () => {
  app = await buildApp({ dbPath: ":memory:", version: "t", setupCode: "setup", allowedOrigins: ["https://compra.example.com"], authRateLimit: 1000, logLevel: "silent" });
  const a = await call("POST", "/api/auth/register", undefined, { name: "Ana", email: "ana@casa.es", password: "supersecreta1", setupCode: "setup", householdName: "Casa" });
  ana = a.body.token; anaId = a.body.user.id;
  const inv = await call("POST", "/api/household/invites", ana);
  const l = await call("POST", "/api/auth/register", undefined, { name: "Luis", email: "luis@casa.es", password: "otrasecreta1", inviteCode: inv.body.code });
  luis = l.body.token; luisId = l.body.user.id;
});
afterAll(() => app.close());

describe("cabeceras de seguridad", () => {
  it("política de contenido estricta", async () => {
    const csp = (await call("GET", "/health")).headers["content-security-policy"] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("wss://compra.example.com");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("cambiar la contraseña", () => {
  it("exige la contraseña actual", async () => {
    expect((await call("POST", "/api/me/password", luis, { current: "mal", next: "nuevaclave123" })).status).toBe(400);
    expect((await call("POST", "/api/me/password", luis, { current: "otrasecreta1", next: "corta" })).status).toBe(400);
    expect((await call("POST", "/api/me/password", undefined, { current: "x", next: "nuevaclave123" })).status).toBe(401);
  });

  it("cambia la clave y cierra las demás sesiones pero no la actual", async () => {
    const other = (await login("luis@casa.es", "otrasecreta1")).body.token;
    expect((await call("GET", "/api/me", other)).status).toBe(200);

    expect((await call("POST", "/api/me/password", luis, { current: "otrasecreta1", next: "nuevaclave123" })).status).toBe(204);

    expect((await call("GET", "/api/me", luis)).status).toBe(200);    // la sesión desde la que se cambia sigue
    expect((await call("GET", "/api/me", other)).status).toBe(401);   // el otro dispositivo se cierra
    expect((await login("luis@casa.es", "otrasecreta1")).status).toBe(401);
    expect((await login("luis@casa.es", "nuevaclave123")).status).toBe(200);
  });
});

describe("sesiones", () => {
  it("lista los dispositivos, marca el actual y describe el navegador", async () => {
    await login("ana@casa.es", "supersecreta1", "Mozilla/5.0 (Windows NT 10.0) Firefox/128.0");
    const r = await call("GET", "/api/me/sessions", ana);
    expect(r.body.sessions.filter((s: Json) => s.current)).toHaveLength(1);
    expect(r.body.sessions.map((s: Json) => s.device)).toContain("Firefox en Windows");
  });

  it("cierra una sesión concreta", async () => {
    const t = (await login("ana@casa.es", "supersecreta1")).body.token;
    const mine = (await call("GET", "/api/me/sessions", t)).body.sessions.find((s: Json) => s.current);
    // Desde otra sesión de Ana se cierra esa.
    expect((await call("DELETE", `/api/me/sessions/${mine.id}`, ana)).status).toBe(204);
    expect((await call("GET", "/api/me", t)).status).toBe(401);
    expect((await call("GET", "/api/me", ana)).status).toBe(200);
  });

  it("no puede cerrar sesiones de otra persona", async () => {
    const lu = (await call("GET", "/api/me/sessions", luis)).body.sessions[0];
    await call("DELETE", `/api/me/sessions/${lu.id}`, ana);
    expect((await call("GET", "/api/me", luis)).status).toBe(200);
  });

  it("cierra todas las demás", async () => {
    const extra = (await login("ana@casa.es", "supersecreta1")).body.token;
    expect((await call("DELETE", "/api/me/sessions/others", ana)).status).toBe(204);
    expect((await call("GET", "/api/me", extra)).status).toBe(401);
    expect((await call("GET", "/api/me/sessions", ana)).body.sessions).toHaveLength(1);
  });
});

describe("recuperar el acceso de otra persona", () => {
  let code: string;

  it("solo un administrador, a un miembro del hogar y no a sí mismo", async () => {
    expect((await call("POST", `/api/household/members/${anaId}/reset`, luis)).status).toBe(403);
    expect((await call("POST", `/api/household/members/${anaId}/reset`, ana)).status).toBe(400);
    expect((await call("POST", `/api/household/members/00000000-0000-4000-8000-000000000000/reset`, ana)).status).toBe(404);
  });

  it("genera un enlace válido", async () => {
    const r = await call("POST", `/api/household/members/${luisId}/reset`, ana);
    expect(r.status).toBe(201);
    code = r.body.code;
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(await call("GET", `/api/reset/${code.toLowerCase()}`)).toMatchObject({ body: { valid: true, name: "Luis" } });
  });

  it("un enlace nuevo invalida el anterior", async () => {
    const second = (await call("POST", `/api/household/members/${luisId}/reset`, ana)).body.code;
    expect((await call("GET", `/api/reset/${code}`)).body.valid).toBe(false);
    code = second;
  });

  it("pone la nueva contraseña, inicia sesión y cierra las sesiones antiguas", async () => {
    const r = await call("POST", "/api/auth/reset", undefined, { code, password: "recuperada123" });
    expect(r.status).toBe(200);
    expect(r.body.user.name).toBe("Luis");
    expect((await call("GET", "/api/me", r.body.token)).status).toBe(200);
    expect((await call("GET", "/api/me", luis)).status).toBe(401);
    expect((await login("luis@casa.es", "nuevaclave123")).status).toBe(401);
    expect((await login("luis@casa.es", "recuperada123")).status).toBe(200);
  });

  it("el enlace es de un solo uso", async () => {
    expect((await call("POST", "/api/auth/reset", undefined, { code, password: "otra-mas-1234" })).status).toBe(400);
    expect((await call("GET", `/api/reset/${code}`)).body.valid).toBe(false);
  });

  it("caduca", async () => {
    const c = (await call("POST", `/api/household/members/${luisId}/reset`, ana)).body.code;
    run(app.db, "UPDATE password_resets SET expires_at = ? WHERE code = ?", Date.now() - 1000, c);
    expect((await call("GET", `/api/reset/${c}`)).body.valid).toBe(false);
    expect((await call("POST", "/api/auth/reset", undefined, { code: c, password: "otra-mas-1234" })).status).toBe(400);
  });

  it("valida la contraseña nueva y no revela si el código existe", async () => {
    const c = (await call("POST", `/api/household/members/${luisId}/reset`, ana)).body.code;
    expect((await call("POST", "/api/auth/reset", undefined, { code: c, password: "corta" })).status).toBe(400);
    const nope = await call("POST", "/api/auth/reset", undefined, { code: "ZZZZZZZZ", password: "otra-mas-1234" });
    expect(nope.status).toBe(400);
    expect(nope.body.message).toBe("El enlace no es válido o ha caducado");
  });

  it("quitar a alguien del hogar anula sus enlaces de recuperación", async () => {
    const inv = await call("POST", "/api/household/invites", ana);
    const t = (await call("POST", "/api/auth/register", undefined, { name: "Peque", email: "peque@casa.es", password: "otrasecreta1", inviteCode: inv.body.code })).body;
    const c = (await call("POST", `/api/household/members/${t.user.id}/reset`, ana)).body.code;
    await call("DELETE", `/api/household/members/${t.user.id}`, ana);
    expect((await call("GET", `/api/reset/${c}`)).body.valid).toBe(false);
  });
});

describe("los demás ven al recién llegado", () => {
  it("unirse por invitación avisa en tiempo real al hogar", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const { default: WebSocket } = await import("ws");
    const msgs: Json[] = [];
    const ws = await new Promise<InstanceType<typeof WebSocket>>((resolve, reject) => {
      const w = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      w.on("message", (d) => { const m = JSON.parse(d.toString()); msgs.push(m); if (m.type === "ready") resolve(w); });
      w.on("open", () => w.send(JSON.stringify({ type: "auth", token: ana })));
      w.on("error", reject);
    });
    msgs.length = 0;
    const inv = await call("POST", "/api/household/invites", ana);
    await call("POST", "/api/auth/register", undefined, { name: "Nuevo", email: "nuevo@casa.es", password: "otrasecreta1", inviteCode: inv.body.code });
    await new Promise((r) => setTimeout(r, 150));
    expect(msgs).toContainEqual({ type: "changed" });
    ws.close();
  });
});
