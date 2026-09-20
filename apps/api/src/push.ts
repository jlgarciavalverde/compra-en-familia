import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { all, get, run, type DB } from "./db";

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta de la app que se abre al pulsar el aviso. */
  url: string;
  /** Avisos con la misma etiqueta se sustituyen entre sí en vez de apilarse. */
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Envía un aviso a un dispositivo. Debe lanzar un error con `statusCode` (404/410 = suscripción caducada). */
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<void>;

/**
 * Solo se envía a los servicios de push conocidos de los navegadores. Sin esta lista, cualquier persona con cuenta
 * podría hacer que el servidor (que está dentro de la red de casa) llamara a direcciones internas.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.apple\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Claves VAPID del servidor: se generan la primera vez y se guardan en la base de datos. */
export function getVapid(db: DB): { publicKey: string; privateKey: string } {
  const row = get(db, "SELECT value FROM kv WHERE key = 'vapid'");
  if (row) return JSON.parse(row.value);
  const keys = webpush.generateVAPIDKeys();
  run(db, "INSERT INTO kv (key, value) VALUES ('vapid', ?)", JSON.stringify(keys));
  return keys;
}

export function createWebPushSender(db: DB, subject: string): PushSender {
  const { publicKey, privateKey } = getVapid(db);
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return async (target, payload) => {
    await webpush.sendNotification(target, JSON.stringify(payload), { TTL: 60 * 60, urgency: "normal", timeout: 10_000 });
  };
}

export type PrefKey = "added" | "assigned" | "shopping" | "completed";
export const PREF_KEYS: PrefKey[] = ["added", "assigned", "shopping", "completed"];

export function getPrefs(db: DB, userId: string): Record<PrefKey, boolean> {
  const r = get(db, "SELECT * FROM notification_prefs WHERE user_id = ?", userId);
  return Object.fromEntries(PREF_KEYS.map((k) => [k, r ? r[k] === 1 : true])) as Record<PrefKey, boolean>;
}

const list = (names: string[]) => {
  const uniq = [...new Set(names)];
  if (uniq.length <= 3) return uniq.length <= 1 ? (uniq[0] ?? "") : `${uniq.slice(0, -1).join(", ")} y ${uniq.at(-1)}`;
  return `${uniq.slice(0, 3).join(", ")} y ${uniq.length - 3} más`;
};

interface Pending {
  names: string[];
  actorName: string;
  listName: string;
  emoji: string;
  householdId: string;
  actorId: string;
  listId: string;
  assigneeId?: string;
  timer?: ReturnType<typeof setTimeout>;
  /** Envía ahora lo acumulado. */
  fire: () => void;
}

type Draft = Omit<Pending, "names" | "timer" | "fire">;

export interface NotifierOptions {
  /** Espera antes de enviar, para juntar varios cambios en un solo aviso. */
  debounceMs?: number;
  log?: (msg: string, err?: unknown) => void;
}

/** Decide a quién avisar de qué, agrupa los cambios seguidos y limpia las suscripciones caducadas. */
export class Notifier {
  private pending = new Map<string, Pending>();
  private lastShopping = new Map<string, number>();
  private completed = new Set<string>();
  private inflight = new Set<Promise<unknown>>();
  private debounceMs: number;

  constructor(private db: DB, private send: PushSender, private opts: NotifierOptions = {}) {
    this.debounceMs = opts.debounceMs ?? 30_000;
  }

  private who(id: string) {
    return (get(this.db, "SELECT name FROM users WHERE id = ?", id)?.name as string | undefined) ?? "Alguien";
  }
  private listInfo(id: string) {
    const r = get(this.db, "SELECT name, emoji FROM lists WHERE id = ?", id);
    return { name: (r?.name as string) ?? "la lista", emoji: (r?.emoji as string) ?? "🛒" };
  }

  private recipients(householdId: string, exceptUserId: string, pref: PrefKey, only?: string): string[] {
    return all(this.db, "SELECT id FROM users WHERE household_id = ? AND removed_at IS NULL AND id != ?", householdId, exceptUserId)
      .map((r) => r.id as string)
      .filter((id) => (only ? id === only : true) && getPrefs(this.db, id)[pref]);
  }

  /** Envía a todos los dispositivos de esas personas. Nunca lanza: un aviso fallido no debe romper la petición. */
  private deliver(userIds: string[], payload: PushPayload): Promise<number> {
    const job = (async () => {
      let sent = 0;
      for (const uid of userIds) {
        for (const s of all(this.db, "SELECT * FROM push_subscriptions WHERE user_id = ?", uid)) {
          try {
            await this.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
            sent++;
          } catch (err) {
            const code = (err as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) run(this.db, "DELETE FROM push_subscriptions WHERE id = ?", s.id);
            else this.opts.log?.("push falló", err);
          }
        }
      }
      return sent;
    })();
    this.inflight.add(job);
    void job.finally(() => this.inflight.delete(job));
    return job;
  }

  /** Aviso directo (prueba desde Ajustes). */
  sendTo(userId: string, payload: PushPayload) {
    return this.deliver([userId], payload);
  }

  /** Junta los cambios seguidos con la misma clave en un solo aviso, que sale tras `debounceMs`. */
  private queue(key: string, draft: () => Draft, name: string, send: (p: Pending) => void) {
    const cur = this.pending.get(key);
    if (cur) {
      cur.names.push(name);
      return;
    }
    const p: Pending = { ...draft(), names: [name], fire: () => undefined };
    p.fire = () => {
      clearTimeout(p.timer);
      this.pending.delete(key);
      send(p);
    };
    p.timer = setTimeout(p.fire, this.debounceMs);
    p.timer.unref?.();
    this.pending.set(key, p);
  }

  itemsAdded(o: { householdId: string; actorId: string; listId: string; names: string[] }) {
    this.completed.delete(o.listId); // hay cosas nuevas: la lista puede volver a completarse
    const info = this.listInfo(o.listId);
    for (const name of o.names) {
      this.queue(`add:${o.listId}:${o.actorId}`, () => ({ actorName: this.who(o.actorId), listName: info.name, emoji: info.emoji, householdId: o.householdId, actorId: o.actorId, listId: o.listId }), name, (p) => {
        void this.deliver(this.recipients(p.householdId, p.actorId, "added"), {
          title: `${p.emoji} ${p.listName}`,
          body: `${p.actorName} añadió ${list(p.names)}`,
          url: `/listas/${p.listId}`, tag: `added-${p.listId}`,
        });
      });
    }
  }

  assigned(o: { householdId: string; actorId: string; assigneeId: string; listId: string; itemName: string }) {
    if (o.assigneeId === o.actorId) return;
    const info = this.listInfo(o.listId);
    this.queue(`asg:${o.listId}:${o.actorId}:${o.assigneeId}`, () => ({ actorName: this.who(o.actorId), listName: info.name, emoji: info.emoji, householdId: o.householdId, actorId: o.actorId, listId: o.listId, assigneeId: o.assigneeId }), o.itemName, (p) => {
      const n = new Set(p.names).size;
      void this.deliver(this.recipients(p.householdId, p.actorId, "assigned", p.assigneeId), {
        title: `${p.emoji} ${p.listName}`,
        body: n === 1 ? `${p.actorName} te ha asignado ${p.names[0]}` : `${p.actorName} te ha asignado ${n} cosas: ${list(p.names)}`,
        url: `/listas/${p.listId}`, tag: `assigned-${p.listId}`,
      });
    });
  }

  shoppingStarted(o: { householdId: string; actorId: string; listId: string }) {
    const key = `${o.actorId}:${o.listId}`;
    const now = Date.now();
    if (now - (this.lastShopping.get(key) ?? 0) < 30 * 60_000) return; // una vez cada 30 min por persona y lista
    this.lastShopping.set(key, now);
    const info = this.listInfo(o.listId);
    void this.deliver(this.recipients(o.householdId, o.actorId, "shopping"), {
      title: `${info.emoji} ${info.name}`,
      body: `${this.who(o.actorId)} empieza a comprar`,
      url: `/listas/${o.listId}`, tag: `shopping-${o.listId}`,
    });
  }

  listCompleted(o: { householdId: string; actorId: string; listId: string }) {
    if (this.completed.has(o.listId)) return;
    this.completed.add(o.listId);
    const info = this.listInfo(o.listId);
    void this.deliver(this.recipients(o.householdId, o.actorId, "completed"), {
      title: `🎉 ${info.name}`,
      body: `${this.who(o.actorId)} ha comprado todo. ¡Lista completa!`,
      url: `/listas/${o.listId}`, tag: `completed-${o.listId}`,
    });
  }

  /** Envía ya lo que estuviera esperando y espera a que terminen los envíos (pruebas y apagado). */
  async flush() {
    for (const p of [...this.pending.values()]) p.fire();
    await Promise.allSettled([...this.inflight]);
  }
}

export const newSubscriptionId = () => randomUUID();
