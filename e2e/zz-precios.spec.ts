import { expect, test, type Page } from "@playwright/test";

// Depende de los specs anteriores (hogar Casa García con Ana como administradora y la tienda "Mercadona").
const SHOTS = process.env.SHOTS_DIR;
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve(undefined));
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** Apunta el precio de una línea desde el chip de la fila (modo tienda). */
async function setLinePrice(page: Page, item: string, current: string | null, value: string) {
  const chip = current
    ? page.getByRole("button", { name: `Precio de ${item}: ${current}. Editar` })
    : page.getByRole("button", { name: `Apuntar el precio de ${item}` });
  await chip.click();
  const dialog = page.getByRole("dialog", { name: "¿Cuánto has pagado?" });
  await dialog.getByLabel("Importe de la línea (€)").fill(value);
  await dialog.getByRole("button", { name: "Guardar precio" }).click();
  await expect(dialog).toHaveCount(0);
}

test("precios: apuntar al comprar, coste estimado y comparador entre tiendas", async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const a = await ctx.newPage();
  await a.goto("/entrar");
  await a.getByLabel("Email").fill("ana@casa.es");
  await a.getByLabel("Contraseña").fill("supersecreta1");
  await a.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(a.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();

  // ---- Las tiendas, con su cadena ----
  await a.getByRole("link", { name: "Ajustes", exact: true }).click();
  await a.getByLabel("Nueva tienda").fill("Family Cash");
  await a.getByRole("button", { name: "Añadir" }).click();
  await a.getByRole("dialog", { name: "Pasillos de la tienda" }).getByRole("radio", { name: "Family Cash" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(a.getByRole("dialog")).toHaveCount(0);
  await a.getByRole("button", { name: /Mercadona/ }).click();
  await a.getByRole("dialog", { name: "Pasillos de la tienda" }).getByRole("radio", { name: "Mercadona" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(a.getByRole("dialog")).toHaveCount(0);
  await expect(a.getByRole("button", { name: /Family Cash/ })).toContainText("Family Cash");

  // ---- Una lista nueva (con una coma decimal, que no debe partir el producto) ----
  await a.getByRole("link", { name: "Listas", exact: true }).click();
  await a.getByRole("button", { name: "Nueva lista" }).click();
  await a.getByLabel("Nombre").fill("Compra precios");
  await a.getByRole("dialog").getByRole("button", { name: "Crear lista" }).click();
  await a.getByRole("link", { name: /Compra precios/ }).click();
  await a.getByLabel("Añadir productos").fill("leche, 1,5 kg de tomates, huevos");
  await a.getByLabel("Añadir productos").press("Enter");
  await expect(a.getByRole("region", { name: "Frutas y verduras" })).toContainText("1,5 kg");
  await expect(a.getByText("Sin productos")).toHaveCount(0);
  await expect(a.getByText(/0 de 3 en el carro/)).toBeVisible();

  // ---- Modo tienda en Mercadona: se marca y se apunta el precio ----
  await a.getByRole("link", { name: "Volver a las listas" }).click();
  await a.getByRole("link", { name: "Comprar", exact: true }).click();
  await a.getByRole("link", { name: /Compra precios/ }).click();
  await a.getByRole("button", { name: /Orden por defecto|Mercadona|Family Cash/ }).first().click();
  await a.getByRole("radio", { name: "Mercadona" }).click();

  await a.getByRole("button", { name: "Marcar Leche como comprado" }).click();
  await setLinePrice(a, "Leche", null, "0,92");
  await a.getByRole("button", { name: "Marcar Tomates como comprado" }).click();
  await setLinePrice(a, "Tomates", null, "2,99");
  await a.getByRole("button", { name: "Marcar Huevos como comprado" }).click();
  await setLinePrice(a, "Huevos", null, "2,50");
  await expect(a.getByText(/Pagado 6,41 €/)).toBeVisible();
  await a.waitForTimeout(500);
  await shot(a, "40-modo-tienda-precios");

  // ---- Lo mismo en Family Cash: se cambia de tienda y se corrigen los importes ----
  await a.getByRole("button", { name: /Mercadona/ }).first().click();
  await a.getByRole("radio", { name: "Family Cash" }).click();
  await setLinePrice(a, "Leche", "0,92 €", "0,85");
  await setLinePrice(a, "Tomates", "2,99 €", "2,40");
  await setLinePrice(a, "Huevos", "2,50 €", "2,90");
  await expect(a.getByText(/Pagado 6,15 €/)).toBeVisible();

  // Sin conexión también se puede apuntar el precio: se guarda y se envía al volver.
  await ctx.setOffline(true);
  await setLinePrice(a, "Huevos", "2,90 €", "2,80");
  await expect(a.getByText(/Sin conexión · 1 cambio por enviar/)).toBeVisible();
  await ctx.setOffline(false);
  await expect(a.getByText(/por enviar|Enviando|Sin conexión/)).toHaveCount(0, { timeout: 15_000 });

  // El historial guarda lo pagado.
  await a.goto("/historial");
  await expect(a.getByRole("article").filter({ hasText: "Compra precios" })).toContainText(/apuntados/);
  await a.getByRole("link", { name: "Listas", exact: true }).click();
  await a.getByRole("link", { name: /Compra precios/ }).click();

  // ---- Se devuelve todo a pendiente y se compara ----
  for (const n of ["Leche", "Tomates", "Huevos"]) await a.getByRole("button", { name: `Devolver ${n} a pendientes` }).click();
  const chip = a.getByRole("link", { name: /Coste estimado 6,05 € en Family Cash/ });
  await expect(chip).toBeVisible();
  await chip.click();

  await expect(a.getByRole("heading", { name: "Comparar precios" })).toBeVisible();
  const cards = a.getByRole("list", { name: "Total por tienda" }).getByRole("listitem");
  await expect(cards.first()).toContainText("Family Cash");
  await expect(cards.first()).toContainText("Más barata");
  await expect(cards.first()).toContainText("6,05 €");
  await expect(cards.nth(1)).toContainText("Mercadona");
  await expect(cards.nth(1)).toContainText("6,41 €");
  await expect(a.getByText(/sale 0,36 € más barata/)).toBeVisible();
  await expect(a.getByText(/ahorraríais 0,30 € más/)).toBeVisible();
  await a.waitForTimeout(700);
  await shot(a, "41-comparador");

  // Producto a producto: la leche y los tomates son más baratos en Family Cash y los huevos en Mercadona.
  const row = (n: string) => a.getByRole("row").filter({ hasText: n });
  await expect(row("Huevos")).toContainText("2,50 €");
  await expect(row("Leche")).toContainText("0,85 €");

  // ---- Precio a mano desde la ficha del producto ----
  await a.getByRole("link", { name: "Volver a la lista" }).click();
  await a.getByRole("button", { name: "Editar Huevos" }).click();
  const sheet = a.getByRole("dialog", { name: "Editar producto" });
  await expect(sheet.getByText("Precios", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("listitem").filter({ hasText: "Mercadona" })).toContainText("2,50 €");
  await sheet.getByRole("listitem").filter({ hasText: "Mercadona" }).getByRole("button", { name: "Editar" }).click();
  await sheet.getByLabel("Precio (€)").fill("2,60");
  await sheet.getByRole("group", { name: "Precio en Mercadona" }).getByRole("button", { name: "Guardar" }).click();
  await expect(sheet.getByRole("listitem").filter({ hasText: "Mercadona" })).toContainText("2,60 €");
  await expect(sheet).toBeVisible(); // guardar el precio no cierra la ficha del producto
  await a.waitForTimeout(400);
  await shot(a, "42-ficha-precios");
  await ctx.close();
});
