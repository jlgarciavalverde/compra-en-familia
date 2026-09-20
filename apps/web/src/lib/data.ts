import { useMemo } from "react";
import { bookIndex, estimateList, type Item, type ListEstimate, type PriceEntry } from "@compra/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListDetail } from "@compra/shared";
import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import { useOutbox } from "./outbox";
import { opListId, overlayDetail, overlayLists, synthDetail, type Op } from "./overlay";

/** No reintentar lo que no se arregla reintentando (sin red, sesión, no encontrado). */
const retry = (n: number, e: unknown) => !(e instanceof ApiError && (e.status === 0 || (e.status >= 400 && e.status < 500))) && n < 2;

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: api.categories, staleTime: 24 * 3600_000, networkMode: "always", retry });
}

/** Catálogo completo del hogar: autocompletado y categoría automática sin red. */
export function useCatalog() {
  const q = useQuery({ queryKey: ["catalog"], queryFn: api.catalog, staleTime: 5 * 60_000, networkMode: "always", retry });
  return q.data?.products;
}

export function useStores() {
  const q = useQuery({ queryKey: ["stores"], queryFn: api.stores, staleTime: 60_000, networkMode: "always", retry });
  return q.data?.stores;
}

/** Libro de precios del hogar (se guarda en el móvil: las estimaciones funcionan sin conexión). */
export function usePriceBook(): PriceEntry[] {
  const q = useQuery({ queryKey: ["prices", "book"], queryFn: api.priceBook, staleTime: 60_000, networkMode: "always", retry });
  return q.data?.book ?? NO_BOOK;
}
const NO_BOOK: PriceEntry[] = [];

/**
 * Coste estimado de lo que falta por comprar en una lista, en la tienda elegida en este dispositivo
 * (si no hay, en la tienda con más productos con precio).
 */
export function usePricing(items: Item[], preferredStoreId: string | null) {
  const stores = useStores();
  const book = usePriceBook();
  const index = useMemo(() => bookIndex(book), [book]);

  return useMemo(() => {
    const pending = items.filter((i) => !i.checkedAt);
    const perStore = (stores ?? []).map((s) => ({ store: s, est: estimateList(pending, index, s.id) }));
    const preferred = perStore.find((p) => p.store.id === preferredStoreId);
    const best = preferred ?? perStore.filter((p) => p.est.priced > 0).sort((a, b) => b.est.priced - a.est.priced)[0] ?? null;
    return {
      stores: stores ?? [],
      book,
      index,
      hasPrices: book.length > 0,
      store: best?.store ?? null,
      estimate: (best?.est ?? null) as ListEstimate | null,
    };
  }, [items, stores, book, index, preferredStoreId]);
}

export function useHistory(limit: number) {
  return useQuery({ queryKey: ["history", limit], queryFn: () => api.history(limit), networkMode: "always", retry, placeholderData: (prev) => prev });
}

export function useSuggestions() {
  const q = useQuery({ queryKey: ["suggestions"], queryFn: api.suggestions, staleTime: 5 * 60_000, networkMode: "always", retry });
  return q.data?.suggestions;
}

/** Plantillas de lista (aparte de las listas normales). */
export function useTemplates(enabled = true) {
  const q = useQuery({ queryKey: ["lists", "templates"], queryFn: api.templates, enabled, networkMode: "always", retry });
  return { templates: q.data?.lists, isPending: q.isPending && !q.data };
}

export function useLists(archived: boolean, enabled = true) {
  const { user } = useAuth();
  const { ops } = useOutbox();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lists", archived], queryFn: () => api.lists(archived), enabled, networkMode: "always", retry });

  const lists = useMemo(() => {
    if (archived) return q.data?.lists;
    const detailOf = (id: string) => {
      const create = ops.find((o): o is Extract<Op, { kind: "createList" }> => o.kind === "createList" && o.list.id === id);
      return qc.getQueryData<ListDetail>(["list", id]) ?? (create ? synthDetail(create) : undefined);
    };
    return overlayLists(q.data?.lists, ops, detailOf, user?.id ?? "");
  }, [q.data, ops, archived, user?.id, qc]);

  return { lists, isPending: !lists && q.isPending, isError: q.isError && !lists };
}

export function useListDetail(id: string) {
  const { user } = useAuth();
  const { ops } = useOutbox();
  const pendingCreate = ops.find((o): o is Extract<Op, { kind: "createList" }> => o.kind === "createList" && o.list.id === id);

  // Una lista creada sin conexión aún no existe en el servidor: no se le pregunta.
  const q = useQuery({ queryKey: ["list", id], queryFn: () => api.list(id), enabled: !pendingCreate, networkMode: "always", retry });

  const data = useMemo(() => {
    const base = q.data ?? (pendingCreate ? synthDetail(pendingCreate) : undefined);
    return base && overlayDetail(base, ops.filter((o) => opListId(o) === id), user?.id ?? "");
  }, [q.data, pendingCreate, ops, id, user?.id]);

  const notFound = q.error instanceof ApiError && q.error.status === 404 && !pendingCreate;
  return { data, isPending: !data && q.isPending, isError: !data && q.isError, notFound, pending: ops.filter((o) => o.kind !== "createList" && opListId(o) === id).length };
}
