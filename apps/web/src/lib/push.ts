import { api } from "./api";

/** El navegador puede recibir avisos push (Chrome/Firefox/Edge en Android y escritorio; en iPhone solo instalada). */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** La clave pública VAPID llega en base64url; el navegador la quiere como bytes. */
export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

const toBody = (sub: PushSubscription) => {
  const j = sub.toJSON();
  return { endpoint: j.endpoint!, keys: { p256dh: j.keys!.p256dh!, auth: j.keys!.auth! } };
};

export type EnableResult = "ok" | "denied" | "unsupported";

/** Pide permiso, suscribe este dispositivo y se lo cuenta al servidor. */
export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return "unsupported";
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const { publicKey } = await api.pushKey();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await api.pushSubscribe(toBody(sub));
  return "ok";
}

/** Deja de recibir avisos en este dispositivo. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/**
 * Si ya hay permiso y suscripción, se la recuerda al servidor (por si el navegador la renovó, o si en este móvil
 * ha entrado otra persona: la suscripción pasa a quien tiene la sesión abierta).
 */
export async function resyncPush(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (sub) await api.pushSubscribe(toBody(sub));
  } catch { /* sin conexión o sin sesión: se reintenta en la próxima visita */ }
}

/** Al cerrar sesión: este móvil ya no debe recibir los avisos de esa cuenta. */
export async function releasePushForLogout(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (sub) await api.pushUnsubscribe(sub.endpoint);
  } catch { /* si no hay conexión, se corrige al volver a suscribirse con otra cuenta */ }
}
