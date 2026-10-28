import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Auditoría automática de accesibilidad (WCAG 2.1 A/AA) de las pantallas principales, en claro y en oscuro.
// Depende de los specs anteriores (hogar con Ana, listas y tiendas). Ana ya tiene la contraseña nueva de zz-seguridad.
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function audit(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700); // deja terminar las animaciones de entrada
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n` + v.nodes.slice(0, 4).map((n) => `    ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`).join("\n"));
  expect(summary, `${name}\n${summary.join("\n")}`).toEqual([]);
}

async function login(browser: Browser, scheme: "light" | "dark") {
  const ctx = await browser.newContext({ ...phone, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto("/entrar");
  await page.getByLabel("Email").fill("ana@casa.es");
  await page.getByLabel("Contraseña").fill("nuevaclave123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();
  return { ctx, page };
}

for (const scheme of ["light", "dark"] as const) {
  test(`accesibilidad (${scheme}): pantallas de la app`, async ({ browser }) => {
    const { ctx, page: p } = await login(browser, scheme);

    await audit(p, `Listas (${scheme})`);

    await p.getByRole("link", { name: /Compra precios/ }).click();
    await expect(p.getByRole("heading", { name: "Compra precios" })).toBeVisible();
    const listUrl = p.url();
    await audit(p, `Lista (${scheme})`);

    await p.goto(`${listUrl}/precios`);
    await expect(p.getByRole("heading", { name: "Comparar precios" })).toBeVisible();
    await audit(p, `Comparador (${scheme})`);

    await p.goto("/comprar");
    await expect(p.getByRole("heading", { name: "¿Qué vas a comprar?" })).toBeVisible();
    await audit(p, `Elegir lista para comprar (${scheme})`);
    await p.getByRole("link", { name: /Empezar/ }).first().click();
    await expect(p.getByRole("button", { name: /Orden por defecto|Mercadona|Family Cash/ }).first()).toBeVisible();
    await audit(p, `Modo tienda (${scheme})`);

    await p.goto("/historial");
    await audit(p, `Historial (${scheme})`);

    await p.goto("/ajustes");
    await expect(p.getByRole("heading", { name: "Seguridad" })).toBeVisible();
    await audit(p, `Ajustes (${scheme})`);

    await ctx.close();
  });
}

test("accesibilidad: acceso, invitación y recuperación (sin sesión)", async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  await p.goto("/entrar");
  await expect(p.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();
  await audit(p, "Entrar");
  await p.goto("/unirse/AAAAAAAA");
  await expect(p.getByRole("heading", { name: "Invitación no válida" })).toBeVisible();
  await audit(p, "Invitación no válida");
  await p.goto("/restablecer/AAAAAAAA");
  await expect(p.getByRole("heading", { name: "Enlace no válido" })).toBeVisible();
  await audit(p, "Enlace no válido");
  await ctx.close();
});
