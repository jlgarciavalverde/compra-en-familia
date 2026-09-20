import type { WebSocket } from "ws";
import type { RealtimeMessage, ShoppingPresence } from "@compra/shared";

interface Conn {
  householdId: string;
  userId: string;
}

/** Salvaguarda: si alguien se olvida de "terminar", la presencia caduca sola. */
const PRESENCE_TTL_MS = 3 * 3600 * 1000;

/** Reparte avisos a los dispositivos conectados de cada hogar y sabe quién está haciendo la compra. */
export class Hub {
  private sockets = new Map<string, Set<WebSocket>>();
  private conns = new WeakMap<WebSocket, Conn>();
  private shopping = new Map<string, Map<string, { listId: string; at: number }>>();

  add(householdId: string, userId: string, ws: WebSocket) {
    let set = this.sockets.get(householdId);
    if (!set) this.sockets.set(householdId, (set = new Set()));
    set.add(ws);
    this.conns.set(ws, { householdId, userId });
    ws.on("close", () => {
      set!.delete(ws);
      if (set!.size === 0) this.sockets.delete(householdId);
      // Sin ninguna conexión abierta de esa persona, deja de figurar como "comprando".
      if (![...(this.sockets.get(householdId) ?? [])].some((s) => this.conns.get(s)?.userId === userId)) {
        this.setShopping(householdId, userId, null);
      }
    });
  }

  send(ws: WebSocket, msg: RealtimeMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(householdId: string, msg: RealtimeMessage) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.get(householdId) ?? []) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  presence(householdId: string): ShoppingPresence[] {
    return [...(this.shopping.get(householdId) ?? [])].map(([userId, v]) => ({ userId, listId: v.listId }));
  }

  /** `listId = null` la quita. Avisa a todo el hogar solo si cambió algo. */
  setShopping(householdId: string, userId: string, listId: string | null) {
    const map = this.shopping.get(householdId) ?? new Map();
    const before = map.get(userId)?.listId ?? null;
    if (before === listId) return;
    if (listId) map.set(userId, { listId, at: Date.now() });
    else map.delete(userId);
    if (map.size) this.shopping.set(householdId, map);
    else this.shopping.delete(householdId);
    this.broadcast(householdId, { type: "presence", shopping: this.presence(householdId) });
  }

  /** Cierra las conexiones de una persona (p. ej. al quitarla del hogar). */
  kick(userId: string) {
    for (const set of this.sockets.values()) {
      for (const ws of set) if (this.conns.get(ws)?.userId === userId) ws.close(4401, "removed");
    }
  }

  /** Ping periódico (Cloudflare cierra las conexiones inactivas a los ~100 s) y caducidad de presencias. */
  pingAll() {
    for (const set of this.sockets.values()) for (const ws of set) if (ws.readyState === ws.OPEN) ws.ping();
    const now = Date.now();
    for (const [hid, map] of [...this.shopping]) {
      for (const [uid, v] of [...map]) if (now - v.at > PRESENCE_TTL_MS) this.setShopping(hid, uid, null);
      if (map.size === 0) this.shopping.delete(hid);
    }
  }

  get size() {
    let n = 0;
    for (const s of this.sockets.values()) n += s.size;
    return n;
  }
}
