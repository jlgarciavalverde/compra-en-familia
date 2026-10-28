import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

test("la app de Android: verificación del dominio y descarga desde Ajustes", async ({ browser, request }) => {
  // Android comprueba que la app pertenece a esta web leyendo este archivo.
  const links = await request.get("/.well-known/assetlinks.json");
  expect(links.status()).toBe(200);
  const [entry] = await links.json();
  expect(entry.relation).toContain("delegate_permission/common.handle_all_urls");
  expect(entry.target.namespace).toBe("android_app");
  expect(entry.target.package_name).toBe("com.redgarverde.compra");
  expect(entry.target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto("/entrar");
  await page.getByLabel("Email").fill("ana@casa.es");
  await page.getByLabel("Contraseña").fill("supersecreta1");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();
  await page.goto("/ajustes");

  const card = page.getByRole("heading", { name: "App para Android" });
  await expect(card).toBeVisible();
  const link = page.getByRole("link", { name: /Descargar la app \(\.apk\) · 1,1 MB/ });
  await expect(link).toHaveAttribute("href", "/app.apk");
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("compra-en-familia.apk");
  expect(readFileSync((await download.path())!, "utf8")).toBe("PKapk-de-prueba");
  await ctx.close();
});
