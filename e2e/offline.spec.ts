import { expect, test, type Browser, type Page } from "@playwright/test";

// Depende de familia.spec.ts (que crea el hogar Casa García, con Ana y Luis y la lista "Súper semanal").
const SHOTS = process.env.SHOTS_DIR;
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve(undefined));
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function login(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();
  return { ctx, page };
}

test("sin conexión se puede seguir comprando y todo se sincroniza al volver", async ({ browser }) => {
  const ana = await login(browser, "ana@casa.es", "supersecreta1");
  const luis = await login(browser, "luis@casa.es", "otrasecreta1");
  const a = ana.page;
  const l = luis.page;

  // Luis vigila la lista desde su móvil.
  await l.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(l.getByRole("heading", { name: "Súper semanal" })).toBeVisible();

  // Ana abre la lista con conexión (queda guardada en el móvil) y espera al service worker.
  await a.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(a.getByRole("heading", { name: "Súper semanal" })).toBeVisible();
  await a.evaluate(async () => { await navigator.serviceWorker.ready; });
  await a.waitForTimeout(1500); // la caché se guarda en el dispositivo con un pequeño retraso

  // ---------- Ana se queda sin conexión ----------
  await ana.ctx.setOffline(true);
  await expect(a.getByText(/Sin conexión/)).toBeVisible();

  const add = a.getByLabel("Añadir productos");
  await add.fill("arroz, 2 kg de naranjas");
  await add.press("Enter");
  await expect(a.getByRole("region", { name: "Despensa" })).toContainText("Arroz");
  await expect(a.getByRole("region", { name: "Frutas y verduras" })).toContainText("Naranjas");
  await expect(a.getByRole("region", { name: "Frutas y verduras" })).toContainText("2 kg");

  await a.getByRole("button", { name: "Marcar Tomates como comprado" }).click();
  await expect(a.getByRole("region", { name: "Comprados" })).toContainText("Tomates");

  // Crea una lista nueva sin red y le añade cosas.
  await a.getByRole("link", { name: "Volver a las listas" }).click();
  await a.getByRole("button", { name: "Nueva lista" }).click();
  await a.getByLabel("Nombre").fill("Fiesta");
  await a.getByRole("radio", { name: "🎉" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Crear lista" }).click();
  await a.getByRole("link", { name: /Fiesta/ }).click();
  await expect(a.getByRole("heading", { name: "Fiesta" })).toBeVisible();
  await a.getByLabel("Añadir productos").fill("globos, refresco de cola x6");
  await a.getByLabel("Añadir productos").press("Enter");
  await expect(a.getByRole("region", { name: "Bebidas" })).toContainText("Refresco de cola");
  await expect(a.getByText(/1 sin enviar/)).toBeVisible();
  await shot(a, "20-offline-fiesta");

  // Recargar la app sin conexión: abre desde el service worker y conserva todo lo pendiente.
  await a.reload();
  await expect(a.getByRole("heading", { name: "Fiesta" })).toBeVisible();
  await expect(a.getByRole("region", { name: "Bebidas" })).toContainText("Refresco de cola");
  await expect(a.getByText(/Sin conexión · 4 cambios por enviar/)).toBeVisible();
  await a.getByRole("link", { name: "Volver a las listas" }).click();
  await a.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(a.getByRole("region", { name: "Despensa" })).toContainText("Arroz");
  await shot(a, "21-offline-recargado");

  // Mientras tanto Luis no ve nada de eso: sigue sin llegar al servidor.
  await expect(l.getByRole("region", { name: "Despensa" })).not.toContainText("Arroz");

  // ---------- Vuelve la conexión ----------
  await ana.ctx.setOffline(false);
  await expect(a.getByText(/por enviar|Enviando|Sin conexión/)).toHaveCount(0, { timeout: 15_000 });

  // Luis lo ve, sin recargar.
  await expect(l.getByRole("region", { name: "Despensa" })).toContainText("Arroz", { timeout: 10_000 });
  await expect(l.getByRole("region", { name: "Frutas y verduras" })).toContainText("2 kg");
  await expect(l.getByRole("region", { name: "Comprados" })).toContainText("Tomates");
  await l.getByRole("link", { name: "Volver a las listas" }).click();
  await expect(l.getByRole("link", { name: /Fiesta/ })).toBeVisible();
  await l.getByRole("link", { name: /Fiesta/ }).click();
  await expect(l.getByRole("region", { name: "Bebidas" })).toContainText("Refresco de cola");
  await expect(l.getByRole("region", { name: "Bebidas" })).toContainText("×6");

  // Y nada se duplicó al reenviar.
  await expect(a.getByRole("region", { name: "Despensa" }).getByText("Arroz", { exact: true })).toHaveCount(1);
  await a.getByRole("link", { name: "Volver a las listas" }).click();
  await expect(a.getByRole("link", { name: /Fiesta/ })).toHaveCount(1);
  await shot(a, "22-sincronizado");

  await ana.ctx.close();
  await luis.ctx.close();
});

test("la app se puede instalar: manifiesto e iconos", async ({ page, request }) => {
  await page.goto("/entrar");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "Compra en Familia", display: "standalone", lang: "es" });
  for (const icon of manifest.icons) expect((await request.get("/" + icon.src)).status()).toBe(200);
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
});
