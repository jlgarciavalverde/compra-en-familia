import { capitalize, stem, type Item, type ItemPatch, type ListDetail, type ListSummary } from "@compra/shared";

/**
 * Cambios hechos por el usuario que aún no ha confirmado el servidor (la "cola de salida").
 * La pantalla muestra siempre `datos del servidor + cambios pendientes`, así que refrescar desde el servidor
 * nunca "borra" lo que acabas de hacer sin conexión.
 */
export interface NewItem {
  id: string;
  name: string;
  qty: number;
  unit: string | null;
  categoryId: string;
  /** La categoría es una suposición local: se omite al enviar para que el servidor decida. */
  categoryAuto?: boolean;
  assigneeId?: string | null;
  note?: string | null;
}

interface Base { id: string; /** cuándo se hizo (ms) */ at: number }

export type Op = Base & (
  | { kind: "createList"; list: { id: string; name: string; emoji: string } }
  | { kind: "addItems"; listId: string; items: NewItem[] }
  | { kind: "updateItem"; listId: string; itemId: string; patch: ItemPatch }
  | { kind: "deleteItem"; listId: string; item: Item }
  | { kind: "restoreItems"; listId: string; items: Item[] }
  | { kind: "clearChecked"; listId: string }
);

export const opListId = (op: Op): string => (op.kind === "createList" ? op.list.id : op.listId);

export function recount(list: ListSummary, items: Item[], at: number): ListSummary {
  return {
    ...list,
    total: items.length,
    checked: items.filter((i) => i.checkedAt).length,
    updatedAt: Math.max(list.updatedAt, at),
  };
}

export const synthDetail = (op: Extract<Op, { kind: "createList" }>): ListDetail => ({
  list: { id: op.list.id, name: op.list.name, emoji: op.list.emoji, archived: false, template: false, total: 0, checked: 0, updatedAt: op.at },
  items: [],
});

function patchItem(i: Item, patch: ItemPatch, me: string, at: number): Item {
  const next: Item = { ...i, updatedAt: at };
  if (patch.name !== undefined) next.name = capitalize(patch.name);
  if (patch.qty !== undefined) next.qty = patch.qty;
  if (patch.unit !== undefined) next.unit = patch.unit;
  if (patch.note !== undefined) next.note = patch.note || null;
  if (patch.categoryId !== undefined) next.categoryId = patch.categoryId;
  if (patch.assigneeId !== undefined) next.assigneeId = patch.assigneeId;
  if (patch.position !== undefined) next.position = patch.position;
  if (patch.price !== undefined) next.price = patch.price;
  if (patch.checked !== undefined) {
    next.checkedAt = patch.checked ? at : null;
    next.checkedBy = patch.checked ? me : null;
  }
  return next;
}

/** Aplica un cambio a una lista. Replica lo que hará el servidor (incluida la fusión de duplicados). */
export function applyToDetail(d: ListDetail, op: Op, me: string): ListDetail {
  if (op.kind === "createList" || op.listId !== d.list.id) return d;
  let items = d.items;

  switch (op.kind) {
    case "addItems": {
      items = [...items];
      for (const n of op.items) {
        // Si el servidor ya lo tiene (su respuesta se cruzó con una recarga), no se vuelve a aplicar.
        if (items.some((i) => i.id === n.id)) continue;
        const st = stem(n.name);
        const idx = items.findIndex((i) => !i.checkedAt && stem(i.name) === st && (i.unit ?? null) === (n.unit ?? null));
        if (idx >= 0) {
          items[idx] = { ...items[idx]!, qty: items[idx]!.qty + n.qty, updatedAt: op.at };
        } else {
          items.push({
            id: n.id, listId: op.listId, name: capitalize(n.name), qty: n.qty, unit: n.unit, note: n.note ?? null,
            categoryId: n.categoryId, assigneeId: n.assigneeId ?? null, checkedAt: null, checkedBy: null,
            createdBy: me, position: op.at + items.length, price: null, updatedAt: op.at,
          });
        }
      }
      break;
    }
    case "updateItem":
      items = items.map((i) => (i.id === op.itemId ? patchItem(i, op.patch, me, op.at) : i));
      break;
    case "deleteItem":
      items = items.filter((i) => i.id !== op.item.id);
      break;
    case "restoreItems": {
      const have = new Set(items.map((i) => i.id));
      items = [...items, ...op.items.filter((i) => !have.has(i.id)).map((i) => ({ ...i, updatedAt: op.at }))];
      break;
    }
    case "clearChecked":
      items = items.filter((i) => !i.checkedAt);
      break;
  }
  items = [...items].sort((a, b) => a.position - b.position);
  return { list: recount(d.list, items, op.at), items };
}

/** Datos del servidor + cambios pendientes de esa lista. */
export function overlayDetail(base: ListDetail, ops: Op[], me: string): ListDetail {
  return ops.reduce((d, op) => applyToDetail(d, op, me), base);
}

/** Resúmenes de las listas con los cambios pendientes (contadores y listas creadas sin conexión). */
export function overlayLists(
  base: ListSummary[] | undefined,
  ops: Op[],
  detailOf: (listId: string) => ListDetail | undefined,
  me: string,
): ListSummary[] | undefined {
  if (!base) return base;
  if (ops.length === 0) return base;
  const out = base.map((l) => {
    const own = ops.filter((o) => opListId(o) === l.id);
    const d = own.length ? detailOf(l.id) : undefined;
    return d ? overlayDetail(d, own, me).list : l;
  });
  for (const op of ops) {
    if (op.kind !== "createList" || out.some((l) => l.id === op.list.id)) continue;
    out.push(overlayDetail(synthDetail(op), ops.filter((o) => opListId(o) === op.list.id), me).list);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
