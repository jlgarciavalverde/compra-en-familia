import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ListDetail, ListSummary } from "@compra/shared";
import { ApiError, sendKeyed } from "./api";
import { uuid } from "./id";
import { KEYS, load, remove, save } from "./store";
import { applyToDetail, opListId, synthDetail, type Op } from "./overlay";

export type NewOp = Op extends infer O ? (O extends Op ? Omit<O, "id" | "at"> : never) : never;

interface State {
  ops: Op[];
  syncing: boolean;
  /** Sin red: el navegador lo dice o el último envío falló por conexión. */
  offline: boolean;
}

const FLUSH_EVERY_MS = 15_000;

let state: State = { ops: [], syncing: false, offline: typeof navigator !== "undefined" && !navigator.onLine };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

let qc: QueryClient | null = null;
let userId: string | null = null;
let onDropped: ((n: number) => void) | null = null;
let flushing = false;
let netFail = false;
let cleanup: (() => void) | null = null;

/**
 * La cola se guarda de forma **síncrona** en localStorage: si la app se cierra o se recarga un instante después de
 * añadir algo sin cobertura, el cambio no se pierde (IndexedDB es asíncrono y una escritura en vuelo se pierde al cerrar).
 * Si localStorage no está disponible, se usa IndexedDB/memoria.
 */
const LS_KEY = "ce_outbox";
type Saved = { userId: string; ops: Op[] };

function readLocal(): Saved | undefined {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Saved) : undefined;
  } catch {
    return undefined;
  }
}

function persist(): Promise<void> {
  if (!userId) return Promise.resolve();
  const saved: Saved = { userId, ops: state.ops };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(saved));
    return Promise.resolve();
  } catch {
    return save(KEYS.outbox, saved);
  }
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Envía un cambio al servidor con su clave de idempotencia (el id del cambio). */
function send(op: Op): Promise<unknown> {
  switch (op.kind) {
    case "createList": return sendKeyed("POST", "/api/lists", op.list, op.id);
    case "addItems": return sendKeyed("POST", `/api/lists/${op.listId}/items`, { items: op.items.map(({ categoryAuto, ...i }) => (categoryAuto ? { ...i, categoryId: undefined } : i)) }, op.id);
    case "updateItem": return sendKeyed("PATCH", `/api/items/${op.itemId}`, op.patch, op.id);
    case "deleteItem": return sendKeyed("DELETE", `/api/items/${op.item.id}`, undefined, op.id);
    case "restoreItems": return sendKeyed("POST", "/api/items/restore", { ids: op.items.map((i) => i.id) }, op.id);
    case "clearChecked": return sendKeyed("POST", `/api/lists/${op.listId}/clear-checked`, {}, op.id);
  }
}

/** Fallos que se resuelven solos reintentando: sin red, servidor caído, límite de tasa o sesión por renovar. */
const isTransient = (e: unknown) =>
  e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429 || e.status === 408 || e.status === 401);

/** Incorpora un cambio ya confirmado a los datos "de servidor" en caché. */
function commit(op: Op) {
  if (!qc || !userId) return;
  const id = opListId(op);
  if (op.kind === "createList") {
    qc.setQueryData<ListDetail>(["list", id], synthDetail(op));
  } else {
    qc.setQueryData<ListDetail>(["list", id], (d) => (d ? applyToDetail(d, op, userId!) : d));
  }
  const d = qc.getQueryData<ListDetail>(["list", id]);
  if (d) {
    qc.setQueryData<{ lists: ListSummary[] }>(["lists", false], (old) => {
      if (!old) return old;
      const lists = old.lists.some((l) => l.id === id) ? old.lists.map((l) => (l.id === id ? d.list : l)) : [d.list, ...old.lists];
      return { lists: lists.sort((a, b) => b.updatedAt - a.updatedAt) };
    });
  }
}

async function flush(): Promise<void> {
  if (flushing || !qc || state.ops.length === 0) return;
  flushing = true;
  set({ syncing: true });
  let sent = 0;
  let dropped = 0;
  const touched = new Set<string>();
  try {
    while (state.ops.length > 0) {
      const op = state.ops[0]!;
      let done = false;
      try {
        await send(op);
        commit(op);
        netFail = false;
        sent++;
        done = true;
      } catch (e) {
        // Borrar algo que ya no existe es lo mismo que haberlo borrado.
        if (e instanceof ApiError && e.status === 404 && op.kind === "deleteItem") {
          commit(op);
          done = true;
        } else if (isTransient(e)) {
          netFail = e instanceof ApiError && e.status === 0;
          break;
        } else {
          // Rechazado de forma definitiva (p. ej. el producto lo borró otra persona): se descarta.
          console.warn("Cambio descartado", op.kind, e);
          dropped++;
          touched.add(opListId(op));
          done = true;
        }
      }
      if (done) {
        // Deja que la caché notifique el cambio confirmado antes de retirarlo de la capa pendiente.
        await tick();
        set({ ops: state.ops.filter((o) => o.id !== op.id) });
        await persist();
      }
    }
  } finally {
    flushing = false;
    set({ syncing: false, offline: !navigator.onLine || netFail });
  }
  if (dropped) onDropped?.(dropped);
  if (state.ops.length === 0 && (sent || dropped)) {
    // Cola vacía: se pide la verdad al servidor (otros pueden haber cambiado cosas, o hubo fusiones).
    qc.invalidateQueries({ queryKey: ["lists"] });
    qc.invalidateQueries({ queryKey: ["list"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["prices"] });
    qc.invalidateQueries({ queryKey: ["history"] });
  }
}

export const outbox = {
  /** Empieza a trabajar para un usuario: recupera lo que quedó pendiente y vigila la conexión. */
  async attach(client: QueryClient, uid: string, dropped: (n: number) => void) {
    outbox.detach();
    qc = client;
    userId = uid;
    onDropped = dropped;
    // Antes se guardaba en IndexedDB: si quedó algo pendiente de esa versión, se recupera y se pasa a localStorage.
    const saved = readLocal() ?? (await load<Saved>(KEYS.outbox));
    if (userId !== uid) return; // se cambió de usuario mientras se cargaba
    set({ ops: saved?.userId === uid ? saved.ops : [], offline: !navigator.onLine });

    const kick = () => { set({ offline: !navigator.onLine }); void flush(); };
    const onVisible = () => document.visibilityState === "visible" && kick();
    window.addEventListener("online", kick);
    window.addEventListener("offline", kick);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (state.ops.length) void flush(); }, FLUSH_EVERY_MS);
    cleanup = () => {
      window.removeEventListener("online", kick);
      window.removeEventListener("offline", kick);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
    void flush();
  },

  detach() {
    cleanup?.();
    cleanup = null;
    qc = null;
    userId = null;
    set({ ops: [], syncing: false });
  },

  /** Anota un cambio: se ve al instante y se envía en cuanto haya conexión. */
  enqueue(op: NewOp) {
    const full = { ...op, id: uuid(), at: Date.now() } as Op;
    set({ ops: [...state.ops, full] });
    void persist();
    void flush();
  },

  flush,

  /** Descarta todo lo pendiente (cierre de sesión). */
  async reset() {
    set({ ops: [] });
    try { localStorage.removeItem(LS_KEY); } catch { /* sin almacenamiento */ }
    await remove(KEYS.outbox);
  },

  getState: () => state,
};

export function useOutbox(): State {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}
