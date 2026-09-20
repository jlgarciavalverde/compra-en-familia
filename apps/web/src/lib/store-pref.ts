import { useCallback, useState } from "react";
import type { Store } from "@compra/shared";

const KEY = "ce_store";
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

/** Tienda elegida en este dispositivo (null = orden de pasillos por defecto). */
export function useSelectedStore(stores: Store[] | undefined) {
  const [id, setId] = useState<string | null>(read);
  const choose = useCallback((next: string | null) => {
    setId(next);
    try { next ? localStorage.setItem(KEY, next) : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  }, []);
  const store = stores?.find((s) => s.id === id) ?? null;
  return { store, choose };
}
