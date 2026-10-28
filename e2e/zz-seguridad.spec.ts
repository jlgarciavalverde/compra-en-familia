import { expect, test, type Browser, type Page } from "@playwright/test";

// Depende de los specs anteriores (hogar Casa García con Ana como administradora).
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

test("seguridad: cambiar contraseña cierra las demás sesiones y se gestionan los dispositivos", async ({ browser }) => {
  const a = await login(browser, "ana@casa.es", "supersecreta1");
  const b = await login(browser, "ana@casa.es", "supersecreta1");   // otro móvil de Ana

  await a.page.goto("/ajustes");
  const form = a.page.getByRole("form", { name: "Cambiar contraseña" });
  await form.getByLabel("Contraseña actual").fill("no-es-esta");
  await form.getByLabel("Contraseña nueva", { exact: true }).fill("nuevaclave123");
  await form.getByLabel("Repite la contraseña nueva").fill("nuevaclave123");
  await form.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(a.page.getByRole("alert")).toContainText("La contraseña actual no es correcta");

  await form.getByLabel("Contraseña actual").fill("supersecreta1");
  await form.getByLabel("Repite la contraseña nueva").fill("distinta12345");
  await form.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(a.page.getByRole("alert")).toContainText("no coinciden");

  await form.getByLabel("Repite la contraseña nueva").fill("nuevaclave123");
  await form.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(a.page.getByText(/Contraseña cambiada/)).toBeVisible();

  // El otro móvil pierde la sesión; la vieja contraseña ya no vale y la nueva sí.
  await b.page.reload();
  await expect(b.page.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();
  await b.page.getByLabel("Email").fill("ana@casa.es");
  await b.page.getByLabel("Contraseña").fill("supersecreta1");
  await b.page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(b.page.getByRole("alert")).toContainText("incorrectos");
  await b.page.getByLabel("Contraseña").fill("nuevaclave123");
  await b.page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(b.page.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();

  // Dispositivos: Ana ve las dos sesiones y cierra la del otro móvil.
  await a.page.reload();
  const devices = a.page.getByRole("heading", { name: /Dispositivos con tu sesión abierta/ }).locator("xpath=following-sibling::ul[1]/li");
  await expect(devices).toHaveCount(2);
  await expect(devices.filter({ hasText: "Este dispositivo" })).toHaveCount(1);
  await a.page.waitForTimeout(400);
  await shot(a.page, "50-seguridad");
  await a.page.getByRole("button", { name: "Cerrar la sesión en los demás dispositivos" }).click();
  await expect(devices).toHaveCount(1);
  await b.page.reload();
  await expect(b.page.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();

  await a.ctx.close();
  await b.ctx.close();
});

test("recuperar el acceso: el administrador genera un enlace de un solo uso", async ({ browser }) => {
  const ana = await login(browser, "ana@casa.es", "nuevaclave123");
  const a = ana.page;

  // Ana invita a Peque.
  await a.goto("/ajustes");
  await a.getByRole("button", { name: "Invitar a alguien" }).click();
  const invite = new URL((await a.getByTestId("invite-link").textContent())!).pathname;
  const peque = await browser.newContext(phone);
  const p = await peque.newPage();
  await p.goto(invite);
  await p.getByLabel("Tu nombre").fill("Peque");
  await p.getByLabel("Email").fill("peque@casa.es");
  await p.getByLabel("Contraseña").fill("laclavedelpeque1");
  await p.getByRole("button", { name: "Unirme al hogar" }).click();
  await expect(p.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();

  // Peque "olvida" la contraseña: Ana le genera un enlace.
  await a.reload();
  await a.getByRole("button", { name: "Restablecer el acceso de Peque" }).click();
  const dialog = a.getByRole("dialog", { name: "Restablecer el acceso" });
  const link = new URL((await dialog.getByTestId("reset-link").textContent())!).pathname;
  expect(link).toMatch(/^\/restablecer\/[A-Z2-9]{8}$/);
  await a.waitForTimeout(600);
  await shot(a, "51-restablecer-acceso");

  // Peque abre el enlace en otro móvil y elige contraseña nueva.
  const otro = await browser.newContext(phone);
  const o = await otro.newPage();
  await o.goto(link);
  await expect(o.getByRole("heading", { name: "Hola, Peque" })).toBeVisible();
  await o.getByLabel("Contraseña nueva").fill("corta");
  await o.getByLabel("Repite la contraseña").fill("corta");
  await o.getByRole("button", { name: "Guardar y entrar" }).click();          // el navegador exige 8 caracteres
  await expect(o.getByRole("heading", { name: "Hola, Peque" })).toBeVisible();
  await o.getByLabel("Contraseña nueva").fill("clavenueva1234");
  await o.getByLabel("Repite la contraseña").fill("otraclave12345");
  await o.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(o.getByRole("alert")).toContainText("no coinciden");
  await o.getByLabel("Repite la contraseña").fill("clavenueva1234");
  await o.getByRole("button", { name: "Guardar y entrar" }).click();
  await expect(o.getByRole("heading", { name: "Vuestras listas" })).toBeVisible();

  // Su sesión anterior se cerró y el enlace no se puede reutilizar.
  await p.reload();
  await expect(p.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();
  await p.goto(link);
  await expect(p.getByRole("heading", { name: "Enlace no válido" })).toBeVisible();

  await ana.ctx.close();
  await peque.close();
  await otro.close();
});

test("la política de contenido no rompe ninguna pantalla y las notificaciones se configuran", async ({ browser }) => {
  const ana = await login(browser, "ana@casa.es", "nuevaclave123");
  const p = ana.page;
  // Chromium sin interfaz siempre dice "denegado": se simulan el permiso y la suscripción del navegador
  // (el servidor sí registra el dispositivo de verdad; no se sale a internet).
  await ana.ctx.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
    Notification.requestPermission = async () => "granted";
    let current: unknown = null;
    const fake = {
      endpoint: "https://fcm.googleapis.com/fcm/send/e2e-dispositivo",
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/e2e-dispositivo",
        keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
      }),
      unsubscribe: async () => { current = null; return true; },
    };
    PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
    PushManager.prototype.subscribe = async () => (current = fake) as unknown as PushSubscription;
  });
  const violations: string[] = [];
  p.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  p.on("pageerror", (e) => { if (/Content Security Policy/i.test(e.message)) violations.push(e.message); });

  for (const path of ["/", "/comprar", "/historial", "/ajustes"]) {
    await p.goto(path);
    await p.waitForLoadState("networkidle");
  }
  const lista = p.getByRole("link", { name: /Compra precios/ });
  await p.goto("/");
  await lista.click();
  await expect(p.getByRole("heading", { name: "Compra precios" })).toBeVisible();
  expect(violations).toEqual([]);

  // Notificaciones: los avisos se eligen uno a uno y se conservan.
  await p.goto("/ajustes");
  const shopping = p.getByRole("switch", { name: "Cuando alguien empieza a comprar" });
  await expect(shopping).toHaveAttribute("aria-checked", "true");
  await shopping.click();
  await expect(shopping).toHaveAttribute("aria-checked", "false");
  await p.reload();
  await expect(p.getByRole("switch", { name: "Cuando alguien empieza a comprar" })).toHaveAttribute("aria-checked", "false");
  await expect(p.getByRole("switch", { name: "Cuando me asignan algo" })).toHaveAttribute("aria-checked", "true");

  // Activar y desactivar las notificaciones en este dispositivo.
  await expect(p.getByText("0 dispositivos suscritos con tu cuenta")).toBeVisible();
  await p.getByRole("button", { name: "Activar en este dispositivo" }).click();
  await expect(p.getByRole("button", { name: "Desactivar en este dispositivo" })).toBeVisible();
  await expect(p.getByText("1 dispositivo suscrito con tu cuenta")).toBeVisible();
  await p.waitForTimeout(300);
  await shot(p, "52-notificaciones");
  await p.getByRole("button", { name: "Desactivar en este dispositivo" }).click();
  await expect(p.getByRole("button", { name: "Activar en este dispositivo" })).toBeVisible();
  await expect(p.getByText("0 dispositivos suscritos con tu cuenta")).toBeVisible();
  await ana.ctx.close();
});
