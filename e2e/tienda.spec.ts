import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Depende de familia.spec.ts y offline.spec.ts (hogar Casa García con Ana admin, Luis y la lista "Súper semanal").
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

/** Arrastra un elemento hasta la posición de otro (con pasos intermedios, como un dedo). */
async function drag(page: Page, handle: Locator, target: Locator, above = true) {
  const h = (await handle.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, above ? t.y - 6 : t.y + t.height + 6, { steps: 20 });
  await page.mouse.up();
}

const sectionOrder = (page: Page) => page.locator("section[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));

test("modo tienda: orden de pasillos por tienda, presencia y terminar compra", async ({ browser }) => {
  const ana = await login(browser, "ana@casa.es", "supersecreta1");
  const luis = await login(browser, "luis@casa.es", "otrasecreta1");
  const a = ana.page;
  const l = luis.page;

  // ---- Ana crea la tienda "Mercadona" y pone la Despensa la primera ----
  await a.getByRole("link", { name: "Ajustes" }).click();
  await a.getByLabel("Nueva tienda").fill("Mercadona");
  await a.getByRole("button", { name: "Añadir" }).click();
  await expect(a.getByRole("dialog", { name: "Pasillos de la tienda" })).toBeVisible();
  await a.waitForTimeout(800); // el panel sube con una animación: se mide cuando ya está quieto
  await drag(a, a.getByRole("img", { name: "Arrastra para mover Despensa" }), a.getByRole("img", { name: "Arrastra para mover Frutas y verduras" }));
  await shot(a, "30-pasillos-tienda");
  await a.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(a.getByRole("dialog")).toHaveCount(0);
  await expect(a.getByRole("button", { name: "Mercadona" })).toBeVisible();

  // ---- Ana entra en modo tienda; Luis lo ve en tiempo real ----
  await a.getByRole("link", { name: "Comprar" }).click();
  await expect(a.getByRole("heading", { name: "¿Qué vas a comprar?" })).toBeVisible();
  await a.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(a.getByRole("button", { name: /Orden por defecto/ })).toBeVisible();
  const defaultOrder = await sectionOrder(a);
  expect(defaultOrder.indexOf("Frutas y verduras")).toBeLessThan(defaultOrder.indexOf("Despensa"));

  await a.getByRole("button", { name: /Orden por defecto/ }).click();
  await a.getByRole("radio", { name: "Mercadona" }).click();
  await expect(a.getByRole("button", { name: /Mercadona/ })).toBeVisible();
  const storeOrder = await sectionOrder(a);
  expect(storeOrder.indexOf("Despensa")).toBeLessThan(storeOrder.indexOf("Frutas y verduras"));
  await a.waitForTimeout(700);
  await shot(a, "31-modo-tienda");

  await expect(l.getByText("Ana está comprando")).toBeVisible({ timeout: 10_000 });
  await l.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(l.getByText("Ana está comprando")).toBeVisible();
  await l.waitForTimeout(500);
  await shot(l, "32-luis-ve-a-ana");

  // ---- Ana compra y termina ----
  await a.getByRole("button", { name: "Marcar Arroz como comprado" }).click();
  await a.getByRole("button", { name: /Terminar compra · \d+\// }).click();
  await expect(a.getByRole("dialog", { name: "Terminar compra" })).toContainText(/Has comprado \d+ productos/);
  await a.getByRole("button", { name: "Terminar y vaciar comprados" }).click();
  await expect(a.getByRole("heading", { name: "¿Qué vas a comprar?" })).toBeVisible();
  await expect(a.getByText(/Compra terminada · \d+ productos/)).toBeVisible();

  // Al salir del modo tienda, Luis deja de ver el aviso.
  await expect(l.getByText("Ana está comprando")).toHaveCount(0, { timeout: 10_000 });
  await ana.ctx.close();

  // ---- Historial de Luis: vuelve a añadir lo comprado ----
  await l.getByRole("link", { name: "Volver a las listas" }).click();
  await l.getByRole("link", { name: "Historial" }).click();
  await expect(l.getByRole("heading", { name: "Hoy" })).toBeVisible();
  await expect(l.getByRole("article").filter({ hasText: "Súper semanal" })).toContainText("Arroz");
  await shot(l, "33-historial");
  await l.getByRole("button", { name: "Volver a añadir Arroz" }).click();
  await l.getByRole("dialog").getByRole("button", { name: /Súper semanal/ }).click();
  await expect(l.getByText(/añadido a «Súper semanal»/)).toBeVisible();
  await l.getByRole("link", { name: "Listas" }).click();
  await l.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(l.getByRole("region", { name: "Despensa" })).toContainText("Arroz");
  await luis.ctx.close();
});

test("ordenar a mano y plantillas", async ({ browser }) => {
  const { ctx, page: p } = await login(browser, "luis@casa.es", "otrasecreta1");
  await p.getByRole("link", { name: /Súper semanal/ }).click();
  const fruta = p.getByRole("region", { name: "Frutas y verduras" });
  const names = () => fruta.getByRole("listitem").evaluateAll((els) => els.map((e) => e.querySelector("button[aria-label^='Editar']")?.getAttribute("aria-label")?.replace("Editar ", "")));

  await expect(fruta.getByRole("listitem")).not.toHaveCount(0);
  const before = await names();
  expect(before.length).toBeGreaterThanOrEqual(2);
  const last = before.at(-1)!;
  await drag(p, p.getByRole("img", { name: `Arrastra para mover ${last}` }), p.getByRole("img", { name: `Arrastra para mover ${before[0]}` }));
  await expect.poll(names).toEqual([last, ...before.slice(0, -1)]);
  await p.waitForTimeout(600);
  await shot(p, "34-reordenado");

  // El orden se guarda (sobrevive a recargar).
  await p.waitForTimeout(500);
  await p.reload();
  await expect.poll(async () => (await names())[0]).toBe(last);

  // ---- Plantillas ----
  await p.getByRole("button", { name: "Opciones de la lista" }).click();
  await p.getByRole("button", { name: "Guardar como plantilla" }).click();
  await expect(p.getByText("Guardada como plantilla")).toBeVisible();
  await p.getByRole("link", { name: "Volver a las listas" }).click();
  await p.getByRole("button", { name: "Ver plantillas" }).click();
  await expect(p.getByRole("link", { name: "Editar plantilla Súper semanal" })).toBeVisible();
  await p.getByRole("button", { name: "Usar plantilla Súper semanal" }).click();
  await expect(p.getByRole("heading", { name: "Súper semanal" })).toBeVisible();
  // La copia conserva el orden relativo. Los productos que estaban comprados vuelven a quedar pendientes
  // (una plantilla es "la compra habitual"), por eso pueden aparecer más.
  await expect.poll(async () => (await names()).filter((n) => before.includes(n!))).toEqual([last, ...before.slice(0, -1)]);
  await expect(p.getByRole("region", { name: "Comprados" })).toHaveCount(0);
  await ctx.close();
});

test("exportar datos y quitar a un miembro", async ({ browser }) => {
  const ana = await login(browser, "ana@casa.es", "supersecreta1");
  const luis = await login(browser, "luis@casa.es", "otrasecreta1");
  const a = ana.page;

  await a.getByRole("link", { name: "Ajustes" }).click();
  const [json] = await Promise.all([a.waitForEvent("download"), a.getByRole("button", { name: /Todo \(JSON\)/ }).click()]);
  expect(json.suggestedFilename()).toMatch(/^compra-en-familia-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync((await json.path())!, "utf8"));
  expect(data.household.name).toBe("Casa García");
  expect(data.members.map((m: { name: string }) => m.name)).toEqual(["Ana", "Luis"]);
  expect(data.lists.some((x: { name: string }) => x.name === "Fiesta")).toBe(true);
  const [csv] = await Promise.all([a.waitForEvent("download"), a.getByRole("button", { name: /Listas \(CSV\)/ }).click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);

  await a.getByRole("button", { name: "Quitar a Luis del hogar" }).click();
  await shot(a, "35-quitar-miembro");
  await a.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(a.getByText("Ya no forma parte del hogar")).toBeVisible();
  await expect(a.getByRole("button", { name: "Quitar a Luis del hogar" })).toHaveCount(0);

  // Luis pierde el acceso al momento.
  await luis.page.reload();
  await expect(luis.page.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();
  await luis.page.getByLabel("Email").fill("luis@casa.es");
  await luis.page.getByLabel("Contraseña").fill("otrasecreta1");
  await luis.page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(luis.page.getByRole("alert")).toContainText("incorrectos");

  await ana.ctx.close();
  await luis.ctx.close();
});
