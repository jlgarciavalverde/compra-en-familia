import { createStore, del, get, set } from "idb-keyval";

/**
 * Almacén local (IndexedDB). Si el navegador no lo permite (modo privado en algunos casos) se usa memoria,
 * de forma que la app siga funcionando aunque no sobreviva a cerrar la pestaña.
 */
const memory = new Map<string, unknown>();
let idb: ReturnType<typeof createStore> | null = null;
try {
  idb = createStore("compra-en-familia", "kv");
} catch {
  idb = null;
}

export const KEYS = { queryCache: "query-cache", outbox: "outbox" } as const;

export async function load<T>(key: string): Promise<T | undefined> {
  try {
    if (idb) return (await get<T>(key, idb)) ?? undefined;
  } catch { /* cae a memoria */ }
  return memory.get(key) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  try {
    if (idb) await set(key, value, idb);
  } catch { /* solo memoria */ }
}

export async function remove(key: string): Promise<void> {
  memory.delete(key);
  try {
    if (idb) await del(key, idb);
  } catch { /* nada que borrar */ }
}

/** Borra todo lo local del usuario (cierre de sesión). */
export async function clearLocalData(): Promise<void> {
  await Promise.all([remove(KEYS.queryCache), remove(KEYS.outbox)]);
}

/** Adaptador para el persistidor de TanStack Query. */
export const asyncStorage = {
  getItem: async (key: string) => (await load<string>(key)) ?? null,
  setItem: (key: string, value: string) => save(key, value),
  removeItem: (key: string) => remove(key),
};
