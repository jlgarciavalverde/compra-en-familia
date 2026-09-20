import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR;
const shot = (page: Page, name: string) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve(undefined);

test("una familia comparte una lista en tiempo real", async ({ browser }) => {
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const anaCtx = await browser.newContext(phone);
  const ana = await anaCtx.newPage();

  // --- Ana crea el hogar ---
  await ana.goto("/");
  await expect(ana.getByRole("heading", { name: "Crea tu hogar" })).toBeVisible();
  await shot(ana, "01-crear-hogar");
  await ana.getByLabel("Tu nombre").fill("Ana");
  await ana.getByLabel("Email").fill("ana@casa.es");
  await ana.getByLabel("Contraseña").fill("supersecreta1");
  await ana.getByLabel("Nombre del hogar").fill("Casa García");
  await ana.getByLabel("Código de configuración").fill("mal");
  await ana.getByRole("button", { name: "Crear mi hogar" }).click();
  await expect(ana.getByRole("alert")).toContainText("código de configuración");
  await ana.getByLabel("Código de configuración").fill("e2e-setup");
  await ana.getByRole("button", { name: "Crear mi hogar" }).click();
  await expect(ana.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();
  await expect(ana.getByText("Aún no hay listas")).toBeVisible();
  await shot(ana, "02-sin-listas");

  // --- Crea una lista ---
  await ana.getByRole("button", { name: "Crear lista" }).click();
  await ana.getByLabel("Nombre").fill("Súper semanal");
  await ana.getByRole("radio", { name: "🥦" }).click();
  await ana.getByRole("dialog").getByRole("button", { name: "Crear lista" }).click();
  await ana.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(ana.getByRole("heading", { name: "Súper semanal" })).toBeVisible();
  await expect(ana.getByText("Lista vacía")).toBeVisible();

  // --- Añade varios de golpe ---
  const add = ana.getByLabel("Añadir productos");
  await add.fill("leche, huevos x12, 2 kg de tomates, pan, papel higiénico, cerveza");
  await add.press("Enter");
  await expect(ana.getByRole("region", { name: "Lácteos y huevos" })).toContainText("Huevos");
  await expect(ana.getByRole("region", { name: "Lácteos y huevos" })).toContainText("×12");
  await expect(ana.getByRole("region", { name: "Frutas y verduras" })).toContainText("2 kg");
  await expect(ana.getByRole("region", { name: "Panadería y bollería" })).toContainText("Pan");
  await expect(ana.getByRole("region", { name: "Higiene y cuidado" })).toContainText("Papel higiénico");
  await expect(ana.getByRole("region", { name: "Bebidas" })).toContainText("Cerveza");

  // --- Autocompletado ---
  await add.click();
  await expect(ana.getByText("Lo que más compráis")).toBeVisible();
  await add.fill("limó");
  const option = ana.getByRole("option", { name: /Limones/ });
  await expect(option).toBeVisible();
  await shot(ana, "03-autocompletado");
  await option.click();
  await expect(ana.getByRole("region", { name: "Frutas y verduras" })).toContainText("Limones");
  await ana.getByRole("heading", { name: "Súper semanal" }).click();

  // --- Marca como comprado ---
  await ana.getByRole("button", { name: "Marcar Leche como comprado" }).click();
  await expect(ana.getByRole("region", { name: "Comprados" })).toContainText("Leche");
  await expect(ana.getByText("1 de 7 en el carro")).toBeVisible();
  await shot(ana, "04-lista");

  // --- Invita a Luis ---
  await ana.goto("/ajustes");
  await ana.getByRole("button", { name: "Invitar a alguien" }).click();
  const link = (await ana.getByTestId("invite-link").textContent())!;
  expect(link).toMatch(/\/unirse\/[A-Z2-9]{8}$/);
  await shot(ana, "05-ajustes");

  const luisCtx = await browser.newContext(phone);
  const luis = await luisCtx.newPage();
  await luis.goto(new URL(link).pathname);
  await expect(luis.getByRole("heading", { name: "Únete a Casa García" })).toBeVisible();
  await luis.getByLabel("Tu nombre").fill("Luis");
  await luis.getByLabel("Email").fill("luis@casa.es");
  await luis.getByLabel("Contraseña").fill("otrasecreta1");
  await luis.getByRole("button", { name: "Unirme al hogar" }).click();
  await expect(luis.getByRole("link", { name: /Súper semanal/ })).toBeVisible();
  await luis.getByRole("link", { name: /Súper semanal/ }).click();

  // La invitación no se puede reutilizar.
  const reuse = await browser.newContext();
  const p3 = await reuse.newPage();
  await p3.goto(new URL(link).pathname);
  await expect(p3.getByRole("heading", { name: "Invitación no válida" })).toBeVisible();
  await reuse.close();

  // --- Tiempo real: Luis añade y Ana lo ve sin recargar ---
  await ana.goto("/");
  await ana.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(ana.getByRole("heading", { name: "Súper semanal" })).toBeVisible();
  await luis.getByLabel("Añadir productos").fill("aceite de oliva 1 l");
  await luis.getByLabel("Añadir productos").press("Enter");
  await expect(ana.getByRole("region", { name: "Despensa" })).toContainText("Aceite de oliva", { timeout: 5000 });

  // Y al revés: Ana marca algo y Luis lo ve en el carro.
  await ana.getByRole("button", { name: "Marcar Pan como comprado" }).click();
  await expect(luis.getByRole("region", { name: "Comprados" })).toContainText("Pan", { timeout: 5000 });
  await shot(luis, "06-luis");

  // --- Asignar y "Lo mío" ---
  await luis.getByRole("button", { name: "Editar Cerveza" }).click();
  await luis.getByRole("radio", { name: "Luis" }).click();
  await luis.getByRole("button", { name: "Guardar" }).click();
  await shot(luis, "07-asignado");
  await luis.getByRole("tab", { name: "Lo mío" }).click();
  await expect(luis.getByRole("region", { name: "Bebidas" })).toContainText("Cerveza");
  await expect(luis.getByRole("region", { name: "Despensa" })).toHaveCount(0);

  // --- Vaciar comprados y deshacer ---
  await luis.getByRole("tab", { name: "Todo" }).click();
  await luis.getByRole("button", { name: "Vaciar comprados" }).click();
  await expect(luis.getByRole("region", { name: "Comprados" })).toHaveCount(0);
  await luis.getByRole("button", { name: "Deshacer" }).click();
  await expect(luis.getByRole("region", { name: "Comprados" })).toContainText("Leche");

  // --- Sesión y cierre ---
  await luis.goto("/ajustes");
  await luis.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(luis.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();
  await shot(luis, "08-entrar");

  await anaCtx.close();
  await luisCtx.close();
});

test("escritorio: barra lateral y lista a pantalla ancha", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("/entrar");
  await page.getByLabel("Email").fill("ana@casa.es");
  await page.getByLabel("Contraseña").fill("supersecreta1");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();
  await shot(page, "09-escritorio-listas");
  await page.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(page.getByRole("heading", { name: "Súper semanal" })).toBeVisible();
  await shot(page, "10-escritorio-lista");
  await ctx.close();

  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const dp = await dark.newPage();
  await dp.goto("/entrar");
  await dp.getByLabel("Email").fill("ana@casa.es");
  await dp.getByLabel("Contraseña").fill("supersecreta1");
  await dp.getByRole("button", { name: "Entrar", exact: true }).click();
  await dp.getByRole("link", { name: /Súper semanal/ }).click();
  await expect(dp.getByRole("heading", { name: "Súper semanal" })).toBeVisible();
  await dp.waitForTimeout(600);
  await shot(dp, "11-oscuro");
  await dark.close();
});
