/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

// Actualización automática: la versión nueva toma el control sin esperar a cerrar todas las pestañas.
void self.skipWaiting();
clientsClaim();

// La app abre sin red: HTML, JS, CSS, fuentes latinas e iconos se precachean (lista generada en la compilación).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Lo que no es la app (API, tiempo real, salud, el APK y la verificación de la app de Android) nunca sale del service worker.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), {
  denylist: [/^\/api\//, /^\/ws/, /^\/health/, /\.apk$/, /^\/version\.json$/, /^\/\.well-known\//],
}));

// ---------- Notificaciones push ----------
interface PushData {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (event) => {
  const data = (event.data?.json() ?? {}) as Partial<PushData>;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Con la app a la vista ya se ve todo en tiempo real: un aviso encima solo molestaría (salvo la prueba de Ajustes).
    if (windows.some((w) => w.visibilityState === "visible") && data.tag !== "test") return;
    await self.registration.showNotification(data.title ?? "Compra en Familia", {
      body: data.body ?? "",
      tag: data.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      lang: "es",
      data: { url: data.url ?? "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | undefined)?.url ?? "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      await open.navigate(url).catch(() => undefined);
    } else {
      await self.clients.openWindow(url);
    }
  })());
});
