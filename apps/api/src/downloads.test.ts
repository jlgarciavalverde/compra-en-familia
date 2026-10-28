import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";

const root = mkdtempSync(join(tmpdir(), "compra-dl-"));
const web = join(root, "web");
const downloads = join(root, "downloads");
mkdirSync(join(web, ".well-known"), { recursive: true });
mkdirSync(join(web, "assets"), { recursive: true });
writeFileSync(join(web, "index.html"), "<html>app</html>");
writeFileSync(join(web, ".well-known", "assetlinks.json"), JSON.stringify([{ target: { package_name: "com.redgarverde.compra" } }]));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const make = (downloadsDir?: string) => buildApp({ dbPath: ":memory:", version: "t", allowedOrigins: [], webDir: web, downloadsDir, logLevel: "silent" });

describe("descarga de la app de Android", () => {
  it("sin APK publicado responde 404 y no cae en la web", async () => {
    const app = await make(downloads);
    for (const url of ["/app.apk", "/version.json"]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode, url).toBe(404);
      expect(r.headers["content-type"]).toContain("application/json");
    }
    await app.close();
  });

  it("sirve el APK con su tipo y como descarga, y la versión publicada", async () => {
    mkdirSync(downloads, { recursive: true });
    writeFileSync(join(downloads, "compra-en-familia.apk"), Buffer.from("PK\u0003\u0004apk-falso"));
    writeFileSync(join(downloads, "version.json"), JSON.stringify({ version: "1.0.0", size: 14 }));
    const app = await make(downloads);
    const apk = await app.inject({ method: "GET", url: "/app.apk" });
    expect(apk.statusCode).toBe(200);
    expect(apk.headers["content-type"]).toBe("application/vnd.android.package-archive");
    expect(apk.headers["content-disposition"]).toContain('attachment; filename="compra-en-familia.apk"');
    expect(apk.rawPayload.subarray(0, 2).toString()).toBe("PK");
    const v = await app.inject({ method: "GET", url: "/version.json" });
    expect(v.json()).toMatchObject({ version: "1.0.0" });
    await app.close();
  });

  it("es público (no pide sesión) para poder bajarlo desde el móvil", async () => {
    const app = await make(downloads);
    expect((await app.inject({ method: "GET", url: "/app.apk" })).statusCode).toBe(200);
    await app.close();
  });

  it("sirve /.well-known/assetlinks.json (Android verifica con él que la app es de este dominio)", async () => {
    const app = await make(downloads);
    const r = await app.inject({ method: "GET", url: "/.well-known/assetlinks.json" });
    expect(r.statusCode).toBe(200);
    expect(r.json()[0].target.package_name).toBe("com.redgarverde.compra");
    // Un archivo que no existe en esa carpeta no se sustituye por la web.
    const missing = await app.inject({ method: "GET", url: "/.well-known/otra-cosa.json" });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).toContain("application/json");
    await app.close();
  });

  it("la web sigue funcionando: portada y rutas de la app", async () => {
    const app = await make(downloads);
    expect((await app.inject({ method: "GET", url: "/" })).body).toContain("app");
    expect((await app.inject({ method: "GET", url: "/listas/123" })).body).toContain("app");
    await app.close();
  });
});
