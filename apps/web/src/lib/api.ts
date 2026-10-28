import type { CatalogProduct, Category, Chain, Household, Item, ItemPatch, ListDetail, ListSummary, ManualPriceInput, PriceEntry, Purchase, SessionInfo, Store, Suggestion, SuggestedProduct, User } from "@compra/shared";

/** En la web va vacío (mismo origen). El APK de Capacitor lo fija a https://compra.redgarverde.com. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

/** URL pública para compartir enlaces (en el APK window.location no sirve). */
export const PUBLIC_URL: string = import.meta.env.VITE_PUBLIC_URL ?? (typeof window !== "undefined" ? window.location.origin : "");

const TOKEN_KEY = "ce_token";

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* sin almacenamiento */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento */ } },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const UNAUTHORIZED_EVENT = "ce:unauthorized";

async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "No hay conexión con el servidor");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, data?.message ?? "Algo ha fallado");
  }
  return data as T;
}

/** Petición con clave de idempotencia: el servidor no la aplica dos veces si se reenvía. */
export const sendKeyed = <T = unknown,>(method: string, path: string, body: unknown, key: string) => request<T>(method, path, body, key);

const get = <T,>(p: string) => request<T>("GET", p);
const post = <T,>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
const patch = <T,>(p: string, b: unknown) => request<T>("PATCH", p, b);
const del = <T = void,>(p: string) => request<T>("DELETE", p);

export interface PushPrefs {
  added: boolean;
  assigned: boolean;
  shopping: boolean;
  completed: boolean;
}

export interface AddItemBody {
  text?: string;
  name?: string;
  qty?: number;
  unit?: string | null;
  categoryId?: string;
  assigneeId?: string | null;
}

export const api = {
  setupStatus: () => get<{ needsSetup: boolean }>("/api/setup-status"),
  invite: (code: string) => get<{ valid: boolean; householdName: string | null }>(`/api/invites/${encodeURIComponent(code)}`),
  register: (b: Record<string, string | undefined>) => post<{ token: string; user: User }>("/api/auth/register", b),
  login: (b: { email: string; password: string }) => post<{ token: string; user: User }>("/api/auth/login", b),
  logout: () => post<void>("/api/auth/logout"),
  me: () => get<{ user: User; household: Household }>("/api/me"),
  updateMe: (b: { name?: string; avatarColor?: string; avatarEmoji?: string }) => patch<{ user: User }>("/api/me", b),
  changePassword: (b: { current: string; next: string }) => post<void>("/api/me/password", b),
  sessions: () => get<{ sessions: SessionInfo[] }>("/api/me/sessions"),
  revokeSession: (id: string) => del(`/api/me/sessions/${id}`),
  resetMember: (id: string) => post<{ code: string; name: string; expiresAt: number }>(`/api/household/members/${id}/reset`),
  resetInfo: (code: string) => get<{ valid: boolean; name: string | null }>(`/api/reset/${encodeURIComponent(code)}`),
  resetPassword: (b: { code: string; password: string }) => post<{ token: string; user: User }>("/api/auth/reset", b),
  pushKey: () => get<{ publicKey: string }>("/api/push/key"),
  pushSubscribe: (b: { endpoint: string; keys: { p256dh: string; auth: string } }) => post<void>("/api/push/subscribe", b),
  pushUnsubscribe: (endpoint: string) => post<void>("/api/push/unsubscribe", { endpoint }),
  pushPrefs: () => get<{ prefs: PushPrefs; devices: number }>("/api/push/prefs"),
  setPushPrefs: (b: Partial<PushPrefs>) => patch<{ prefs: PushPrefs }>("/api/push/prefs", b),
  pushTest: () => post<{ sent: number }>("/api/push/test"),
  createInvite: () => post<{ code: string; expiresAt: number }>("/api/household/invites"),
  catalog: () => get<{ products: CatalogProduct[] }>("/api/catalog"),
  categories: () => get<{ categories: Category[] }>("/api/categories"),
  suggest: (q: string) => get<{ suggestions: Suggestion[] }>(`/api/products/suggest?q=${encodeURIComponent(q)}`),
  lists: (archived = false) => get<{ lists: ListSummary[] }>(`/api/lists${archived ? "?archived=1" : ""}`),
  templates: () => get<{ lists: ListSummary[] }>("/api/lists?template=1"),
  createList: (b: { name: string; emoji?: string }) => post<{ list: ListSummary }>("/api/lists", b),
  list: (id: string) => get<ListDetail>(`/api/lists/${id}`),
  updateList: (id: string, b: { name?: string; emoji?: string; archived?: boolean }) => patch<{ list: ListSummary }>(`/api/lists/${id}`, b),
  deleteList: (id: string) => del(`/api/lists/${id}`),
  duplicateList: (id: string, b: { template?: boolean; name?: string } = {}) => post<{ list: ListSummary }>(`/api/lists/${id}/duplicate`, b),
  addItems: (listId: string, b: AddItemBody) => post<{ items: Item[] }>(`/api/lists/${listId}/items`, b),
  updateItem: (id: string, b: ItemPatch) => patch<{ item: Item }>(`/api/items/${id}`, b),
  deleteItem: (id: string) => del(`/api/items/${id}`),
  clearChecked: (listId: string) => post<{ ids: string[] }>(`/api/lists/${listId}/clear-checked`),
  restoreItems: (ids: string[]) => post<{ restored: boolean }>("/api/items/restore", { ids }),
  removeMember: (id: string) => del(`/api/household/members/${id}`),
  stores: () => get<{ stores: Store[] }>("/api/stores"),
  createStore: (b: { name: string; order?: string[]; chain?: Chain | null }) => post<{ store: Store }>("/api/stores", b),
  updateStore: (id: string, b: { name?: string; order?: string[]; chain?: Chain | null }) => patch<{ store: Store }>(`/api/stores/${id}`, b),
  deleteStore: (id: string) => del(`/api/stores/${id}`),
  priceBook: () => get<{ book: PriceEntry[] }>("/api/prices/book"),
  setPrice: (b: ManualPriceInput) => request<{ entry: PriceEntry }>("PUT", "/api/prices/manual", b),
  deletePrice: (stem: string, storeId: string) => del(`/api/prices/manual?stem=${encodeURIComponent(stem)}&storeId=${encodeURIComponent(storeId)}`),
  priceHistory: (stem: string, storeId: string) =>
    get<{ points: Array<{ at: number; price: number; unitPrice: number | null; source: string }> }>(`/api/prices/history?stem=${encodeURIComponent(stem)}&storeId=${encodeURIComponent(storeId)}`),
  history: (limit: number) => get<{ purchases: Purchase[]; hasMore: boolean }>(`/api/history?limit=${limit}`),
  suggestions: () => get<{ suggestions: SuggestedProduct[] }>("/api/suggestions"),
  health: () => get<{ version: string }>("/health"),
};

/** Descarga los datos del hogar como archivo (JSON completo o CSV de listas). */
export async function downloadExport(format: "json" | "csv"): Promise<void> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/export?format=${format}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, "No hay conexión con el servidor");
  }
  if (!res.ok) throw new ApiError(res.status, "No se pudo descargar");
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `compra-en-familia.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
