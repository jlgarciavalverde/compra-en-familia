import { useSyncExternalStore } from "react";
import type { ClientMessage, ShoppingPresence } from "@compra/shared";

/** Quién está haciendo la compra ahora mismo (lo recibe del servidor por el canal en tiempo real). */
let shopping: ShoppingPresence[] = [];
/** La lista que estoy comprando yo (se reenvía al reconectar). */
let mine: string | null = null;
let sender: ((m: ClientMessage) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const presence = {
  setSender(fn: ((m: ClientMessage) => void) | null) {
    sender = fn;
  },
  set(list: ShoppingPresence[]) {
    shopping = list;
    emit();
  },
  /** Anuncia (o deja de anunciar con null) que estoy comprando esta lista. */
  announce(listId: string | null) {
    mine = listId;
    sender?.({ type: "shopping", listId });
  },
  /** Tras reconectar: el servidor no recuerda nada de la conexión anterior. */
  resend() {
    if (mine) sender?.({ type: "shopping", listId: mine });
  },
};

export function usePresence(): ShoppingPresence[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => shopping,
  );
}
