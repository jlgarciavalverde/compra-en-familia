import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { ArrowUp, CaretDown, CaretLeft, CurrencyEur, DotsSixVertical, DotsThreeVertical, Lightbulb, Minus, NotePencil, Plus, Scales, Trash } from "@phosphor-icons/react";
import {
  ITEM_SEPARATOR, UNITS, findProduct, formatEuro, parseItem, parseItemsText, searchCatalog, stem,
  type CatalogProduct, type Category, type Item, type ItemPatch, type ListDetail, type User,
} from "@compra/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { categoryIcon } from "../lib/categories";
import { cn, formatQty } from "../lib/cn";
import { useCatalog, useCategories, useListDetail, usePricing, useStores, useSuggestions } from "../lib/data";
import { useSelectedStore } from "../lib/store-pref";
import { positionFor } from "../lib/order";
import { uuid } from "../lib/id";
import { outbox } from "../lib/outbox";
import type { NewItem } from "../lib/overlay";
import { useToast } from "../components/toast";
import { Avatar, Button, EmojiPicker, EmptyState, Field, IconButton, Sheet, Spinner } from "../components/ui";
import { Shoppers } from "../components/presence";
import { PriceSection } from "../components/price-ui";

// ---------- Fila de producto ----------
interface RowProps {
  item: Item;
  members: User[];
  onToggle: (i: Item) => void;
  onEdit: (i: Item) => void;
  /** Modo tienda: filas y textos más grandes. */
  large?: boolean;
  /** Reserva el hueco del asa de arrastre para que todas las filas queden alineadas. */
  spacer?: boolean;
  /** Modo tienda: permite apuntar el precio pagado de la línea. */
  onPrice?: (i: Item) => void;
  /** Precio estimado de la línea según el libro (solo se muestra en modo tienda). */
  estimate?: number | null;
}

const rowClass = (large?: boolean) =>
  cn("flex items-center gap-1 rounded-2xl bg-surface pr-3 shadow-card", large && "min-h-[4.5rem]");

function RowBody({ item, members, onToggle, onEdit, large, spacer, onPrice, estimate, handle }: RowProps & { handle?: ReactNode }) {
  const checked = !!item.checkedAt;
  const qty = formatQty(item.qty, item.unit);
  const assignee = members.find((m) => m.id === item.assigneeId);
  return (
    <>
      {handle ?? (spacer && <span className="w-7 shrink-0" aria-hidden />)}
      <button
        onClick={() => onToggle(item)} aria-pressed={checked}
        aria-label={checked ? `Devolver ${item.name} a pendientes` : `Marcar ${item.name} como comprado`}
        className={cn("grid shrink-0 place-items-center", large ? "size-[4.5rem]" : "size-14", (!!handle || spacer) && "-ml-1")}
      >
        <motion.span
          animate={{ scale: checked ? [1, 1.25, 1] : 1 }} transition={{ duration: 0.28 }}
          className={cn("grid place-items-center rounded-full border-2 transition-colors", large ? "size-9" : "size-7",
            checked ? "border-sage bg-sage" : "border-muted/50 bg-transparent")}
        >
          {checked && (
            <svg viewBox="0 0 24 24" className={large ? "size-5" : "size-4"} fill="none" stroke="var(--surface)" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25 }} />
            </svg>
          )}
        </motion.span>
      </button>
      <button onClick={() => onEdit(item)} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2 text-left" aria-label={`Editar ${item.name}`}>
        <span className={cn("truncate font-bold transition-colors", large ? "text-xl" : "text-[17px]", checked && "text-muted line-through decoration-2")}>{item.name}</span>
        {item.note && <span className="flex items-center gap-1 truncate text-sm text-muted"><NotePencil size={14} aria-hidden />{item.note}</span>}
      </button>
      {qty && <span className={cn("rounded-full bg-surface-2 px-3 py-1 font-bold text-muted", large ? "text-base" : "text-sm")}>{qty}</span>}
      {onPrice && item.price != null && (
        <button onClick={() => onPrice(item)} aria-label={`Precio de ${item.name}: ${formatEuro(item.price)}. Editar`}
          className="rounded-full bg-sage/20 px-3 py-1 text-base font-bold transition active:scale-95">{formatEuro(item.price)}</button>
      )}
      {onPrice && item.price == null && checked && (
        <button onClick={() => onPrice(item)} aria-label={`Apuntar el precio de ${item.name}`}
          className="rounded-full border border-dashed border-muted/60 px-3 py-1 text-base font-bold text-muted transition active:scale-95">+ precio</button>
      )}
      {large && !checked && estimate != null && (
        <span className="text-base text-muted" aria-label={`Precio estimado ${formatEuro(estimate)}`}>≈ {formatEuro(estimate)}</span>
      )}
      {assignee && <Avatar user={assignee} size={large ? 34 : 28} />}
    </>
  );
}

export const ItemRow = memo(function ItemRow(props: RowProps) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className={rowClass(props.large)}
    >
      <RowBody {...props} />
    </motion.li>
  );
});

/** Fila que se puede arrastrar (por el asa de la izquierda) para cambiar el orden. */
function ReorderRow({ item, onDragEnd, ...props }: RowProps & { onDragEnd: () => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="li" value={item} dragListener={false} dragControls={controls} onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.03, zIndex: 10 }} transition={{ type: "spring", stiffness: 500, damping: 36 }}
      className={cn(rowClass(props.large), "relative")}
    >
      <RowBody
        item={item} {...props}
        handle={
          <span
            onPointerDown={(e) => controls.start(e)}
            role="img" aria-label={`Arrastra para mover ${item.name}`}
            className="grid h-14 w-7 shrink-0 cursor-grab touch-none place-items-center pl-1 text-muted/60 active:cursor-grabbing"
          >
            <DotsSixVertical size={20} weight="bold" aria-hidden />
          </span>
        }
      />
    </Reorder.Item>
  );
}

/** Productos de un pasillo. Con `reorderable` se pueden reordenar arrastrando. */
function ItemGroup({ items, reorderable, onMove, ...props }: Omit<RowProps, "item"> & {
  items: Item[]; reorderable: boolean; onMove: (id: string, position: number) => void;
}) {
  const [order, setOrder] = useState(items);
  const latest = useRef(order);
  latest.current = order;
  useEffect(() => setOrder(items), [items]);

  if (!reorderable || items.length < 2) {
    return (
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>{items.map((it) => <ItemRow key={it.id} item={it} {...props} spacer={reorderable} />)}</AnimatePresence>
      </ul>
    );
  }
  return (
    <Reorder.Group as="ul" axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
      {order.map((it) => (
        <ReorderRow
          key={it.id} item={it} {...props}
          onDragEnd={() => {
            const pos = positionFor(latest.current, it.id);
            if (pos !== null) onMove(it.id, pos);
          }}
        />
      ))}
    </Reorder.Group>
  );
}

// ---------- Sugerencias: "suele faltar" ----------
function SuggestionChips({ listId, items }: { listId: string; items: Item[] }) {
  const suggestions = useSuggestions();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const inList = new Set(items.filter((i) => !i.checkedAt).map((i) => stem(i.name)));
  const visible = (suggestions ?? []).filter((s) => !inList.has(stem(s.name)) && !hidden.has(s.name)).slice(0, 8);
  if (visible.length === 0) return null;

  return (
    <section aria-label="Suele faltar" className="mb-4">
      <p className="mb-2 flex items-center gap-1.5 px-1 text-sm font-bold text-muted">
        <Lightbulb size={16} weight="duotone" className="text-mustard" aria-hidden /> Suele faltar
      </p>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {visible.map((s) => (
          <li key={s.name} className="shrink-0">
            <button
              aria-label={`Añadir ${s.name}`} title={`Lo compráis cada ~${s.everyDays} días; hace ${s.daysSince}`}
              onClick={() => {
                outbox.enqueue({ kind: "addItems", listId, items: [{ id: uuid(), name: s.name, qty: 1, unit: null, categoryId: s.categoryId }] });
                setHidden((h) => new Set(h).add(s.name));
              }}
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-mustard/70 bg-surface px-4 text-sm font-bold transition active:scale-95"
            >
              <Plus size={14} weight="bold" aria-hidden /> {s.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Barra de añadir con autocompletado ----------
const NO_PRODUCTS: CatalogProduct[] = [];

/** El catálogo local aprende al instante lo que se añade (el servidor lo hará al recibirlo). */
function learn(qc: ReturnType<typeof useQueryClient>, items: NewItem[]) {
  qc.setQueryData<{ products: CatalogProduct[] }>(["catalog"], (old) => {
    if (!old) return old;
    const products = [...old.products];
    for (const it of items) {
      const known = findProduct(products, it.name);
      if (known) {
        products[products.indexOf(known)] = { ...known, useCount: known.useCount + 1 };
      } else {
        products.push({ name: it.name, stem: it.name.toLowerCase(), categoryId: it.categoryId, defaultUnit: null, useCount: 1 });
      }
    }
    return { products };
  });
}

function AddBar({ listId, categories }: { listId: string; categories: Category[] }) {
  const qc = useQueryClient();
  const catalog = useCatalog() ?? NO_PRODUCTS;
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);

  const segment = text.split(ITEM_SEPARATOR).pop() ?? "";
  const multi = ITEM_SEPARATOR.test(text);
  const q = parseItem(segment)?.name ?? "";
  const suggestions = useMemo(() => (focused ? searchCatalog(catalog, q) : []), [catalog, q, focused]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const otros = categories.find((c) => c.key === "otros")?.id ?? categories.at(-1)?.id ?? "";

  const enqueue = (items: NewItem[]) => {
    if (items.length === 0) return;
    outbox.enqueue({ kind: "addItems", listId, items });
    learn(qc, items);
  };

  const submit = () => {
    enqueue(parseItemsText(text).map((p) => {
      const known = findProduct(catalog, p.name);
      return { id: uuid(), name: p.name, qty: p.qty, unit: p.unit, categoryId: known?.categoryId ?? otros, categoryAuto: !known };
    }));
    setText("");
  };

  const pick = (s: CatalogProduct) => {
    if (multi) {
      setText(text.slice(0, text.length - segment.length).replace(/\s*$/, " ") + s.name + ", ");
      return;
    }
    const p = parseItem(segment);
    enqueue([{ id: uuid(), name: s.name, qty: p?.qty ?? 1, unit: p?.unit ?? null, categoryId: s.categoryId }]);
    setText("");
  };

  const showSuggestions = suggestions.length > 0;
  const showingFrequent = q === "";

  return (
    <div className="sticky bottom-0 z-20 bg-gradient-to-t from-bg from-70% to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-6">
      <div className="relative">
        <AnimatePresence>
          {showSuggestions && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.14 }}
              className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-card bg-surface shadow-card"
              role="listbox" aria-label="Sugerencias"
            >
              {showingFrequent && <p className="px-4 pt-3 text-xs font-bold uppercase tracking-wide text-muted">Lo que más compráis</p>}
              <ul className="max-h-64 overflow-y-auto py-1">
                {suggestions.map((s) => {
                  const cat = catById.get(s.categoryId);
                  const Icon = categoryIcon(cat?.key ?? "otros");
                  return (
                    <li key={s.name}>
                      {/* onMouseDown evita que el input pierda el foco antes del clic */}
                      <button role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
                        className="flex min-h-12 w-full items-center gap-3 px-4 text-left hover:bg-surface-2">
                        <Icon size={22} weight="duotone" className="text-primary" aria-hidden />
                        <span className="flex-1 font-bold">{s.name}</span>
                        <span className="text-sm text-muted">{cat?.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex items-center gap-2 rounded-full border border-line bg-surface p-1.5 pl-5 shadow-card focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15">
          <input
            value={text} onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholder="Añadir: leche, huevos x12, pan…"
            aria-label="Añadir productos"
            enterKeyHint="send" autoComplete="off" autoCapitalize="sentences" maxLength={1000}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/70"
          />
          <button type="submit" aria-label="Añadir" disabled={!text.trim()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition active:scale-90 disabled:opacity-40">
            <ArrowUp size={22} weight="bold" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- Hoja de edición de un producto ----------
export function ItemSheet({ item, categories, members, listId, onClose }: {
  item: Item | null; categories: Category[]; members: User[]; listId: string; onClose: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Item | null>(item);
  const [orig, setOrig] = useState<Item | null>(item);
  const [prevId, setPrevId] = useState(item?.id);
  // Al abrir otro producto se parte de su estado actual; los cambios de otras personas no pisan lo que se está editando.
  if (item?.id !== prevId) { setPrevId(item?.id); setDraft(item); setOrig(item); }

  const save = () => {
    if (!draft || !orig || !draft.name.trim()) return;
    const patch: ItemPatch = {};
    if (draft.name.trim() !== orig.name) patch.name = draft.name.trim();
    if (draft.qty !== orig.qty) patch.qty = draft.qty;
    if (draft.unit !== orig.unit) patch.unit = draft.unit as ItemPatch["unit"];
    if ((draft.note ?? null) !== (orig.note ?? null)) patch.note = draft.note;
    if (draft.categoryId !== orig.categoryId) patch.categoryId = draft.categoryId;
    if (draft.assigneeId !== orig.assigneeId) patch.assigneeId = draft.assigneeId;
    if (Object.keys(patch).length) outbox.enqueue({ kind: "updateItem", listId, itemId: orig.id, patch });
    onClose();
  };

  const remove = () => {
    if (!orig) return;
    const gone = orig;
    outbox.enqueue({ kind: "deleteItem", listId, item: gone });
    onClose();
    toast({ message: "Producto eliminado", actionLabel: "Deshacer", onAction: () => outbox.enqueue({ kind: "restoreItems", listId, items: [gone] }) });
  };

  const set = (p: Partial<Item>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const step = draft && (draft.unit === "kg" || draft.unit === "l") ? 0.5 : 1;

  return (
    <Sheet open={!!item} onClose={onClose} title="Editar producto">
      {draft && (
        <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Producto" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} />

          <div>
            <p className="mb-1.5 text-sm font-bold text-muted">Cantidad</p>
            <div className="flex items-center gap-3">
              <IconButton label="Menos" type="button" className="bg-surface-2" onClick={() => set({ qty: Math.max(step, +(draft.qty - step).toFixed(2)) })}><Minus size={20} weight="bold" /></IconButton>
              <input
                type="number" inputMode="decimal" min={0.01} step="any" aria-label="Cantidad"
                value={draft.qty} onChange={(e) => set({ qty: Number(e.target.value) || 1 })}
                className="min-h-12 w-24 rounded-2xl border border-line bg-surface text-center text-xl font-bold outline-none focus:border-primary"
              />
              <IconButton label="Más" type="button" className="bg-surface-2" onClick={() => set({ qty: +(draft.qty + step).toFixed(2) })}><Plus size={20} weight="bold" /></IconButton>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Unidad">
              {[null, ...UNITS].map((u) => (
                <button key={u ?? "none"} type="button" role="radio" aria-checked={draft.unit === u} onClick={() => set({ unit: u })}
                  className={cn("min-h-10 rounded-full px-4 text-sm font-bold transition", draft.unit === u ? "bg-primary text-on-primary" : "bg-surface-2 text-muted")}>
                  {u ?? "sin unidad"}
                </button>
              ))}
            </div>
          </div>

          <Field label="Nota" placeholder="Marca, tamaño, sin gluten…" value={draft.note ?? ""} onChange={(e) => set({ note: e.target.value || null })} maxLength={200} />

          <div>
            <p className="mb-1.5 text-sm font-bold text-muted">Pasillo</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pasillo">
              {categories.map((c) => {
                const Icon = categoryIcon(c.key);
                const on = draft.categoryId === c.id;
                return (
                  <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => set({ categoryId: c.id })}
                    className={cn("flex min-h-12 items-center gap-2 rounded-2xl px-3 text-left text-sm font-bold transition", on ? "bg-primary/15 text-primary ring-2 ring-primary" : "bg-surface-2 text-muted")}>
                    <Icon size={20} weight="duotone" aria-hidden /><span className="leading-tight">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-bold text-muted">¿Quién lo compra?</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Asignar a">
              {[null, ...members].map((m) => (
                <button key={m?.id ?? "nadie"} type="button" role="radio" aria-checked={draft.assigneeId === (m?.id ?? null)}
                  onClick={() => set({ assigneeId: m?.id ?? null })}
                  className={cn("flex min-h-11 items-center gap-2 rounded-full pl-2 pr-4 text-sm font-bold transition", draft.assigneeId === (m?.id ?? null) ? "bg-primary text-on-primary" : "bg-surface-2 text-muted")}>
                  {m ? <Avatar user={m} size={28} /> : <span className="w-2" />}{m ? m.name : "Cualquiera"}
                </button>
              ))}
            </div>
          </div>

          <PriceSection name={draft.name} qty={draft.qty} unit={draft.unit} />

          <div className="flex gap-3">
            <Button type="button" variant="danger" onClick={remove} aria-label="Eliminar producto"><Trash size={20} /></Button>
            <Button type="submit" className="flex-1" disabled={!draft.name.trim()}>Guardar</Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

// ---------- Opciones de la lista ----------
function OptionsSheet({ list, open, onClose }: { list: ListDetail["list"]; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(list.name);
  const [emoji, setEmoji] = useState(list.emoji);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (open) { setName(list.name); setEmoji(list.emoji); setConfirmDelete(false); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { qc.invalidateQueries({ queryKey: ["lists"] }); qc.invalidateQueries({ queryKey: ["list", list.id] }); };
  const fail = (e: Error) => toast({ message: e.message, tone: "error" });

  const rename = useMutation({ mutationFn: () => api.updateList(list.id, { name, emoji }), onSuccess: () => { refresh(); onClose(); }, onError: fail });
  const archive = useMutation({
    mutationFn: () => api.updateList(list.id, { archived: !list.archived }),
    onSuccess: () => { refresh(); onClose(); if (!list.archived) navigate("/"); }, onError: fail,
  });
  const duplicate = useMutation({
    mutationFn: () => api.duplicateList(list.id),
    onSuccess: ({ list: l }) => { refresh(); onClose(); navigate(`/listas/${l.id}`); toast({ message: "Lista duplicada" }); }, onError: fail,
  });
  const saveTemplate = useMutation({
    mutationFn: () => api.duplicateList(list.id, { template: true }),
    onSuccess: () => { refresh(); onClose(); toast({ message: "Guardada como plantilla" }); }, onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteList(list.id),
    onSuccess: () => { refresh(); onClose(); navigate("/"); toast({ message: "Lista eliminada" }); }, onError: fail,
  });

  return (
    <Sheet open={open} onClose={() => { setConfirmDelete(false); onClose(); }} title="Opciones de la lista">
      <div className="flex flex-col gap-5">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate(); }}>
          <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <Button type="submit" disabled={!name.trim() || rename.isPending}>Guardar cambios</Button>
        </form>
        <div className="h-px bg-line" />
        {!list.template && (
          <Button variant="soft" onClick={() => { onClose(); navigate(`/listas/${list.id}/precios`); }}><Scales size={20} aria-hidden /> Comparar precios entre tiendas</Button>
        )}
        <Button variant="soft" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>{list.template ? "Usar esta plantilla" : "Duplicar lista"}</Button>
        {!list.template && (
          <Button variant="soft" onClick={() => saveTemplate.mutate()} disabled={saveTemplate.isPending}>Guardar como plantilla</Button>
        )}
        {!list.template && (
          <Button variant="soft" onClick={() => archive.mutate()} disabled={archive.isPending}>{list.archived ? "Sacar del archivo" : "Archivar lista"}</Button>
        )}
        {confirmDelete ? (
          <Button variant="primary" onClick={() => remove.mutate()} disabled={remove.isPending}>Sí, eliminar «{list.name}»</Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash size={20} /> Eliminar lista</Button>
        )}
      </div>
    </Sheet>
  );
}

// ---------- Página ----------
export function ListPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { user, household } = useAuth();
  const members = household?.members ?? [];

  const detail = useListDetail(id);
  const cats = useCategories();

  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [options, setOptions] = useState(false);
  const [showDone, setShowDone] = useState(true);

  const toggle = (it: Item) =>
    outbox.enqueue({ kind: "updateItem", listId: id, itemId: it.id, patch: { checked: !it.checkedAt } });

  const move = (itemId: string, position: number) =>
    outbox.enqueue({ kind: "updateItem", listId: id, itemId, patch: { position } });

  const clearChecked = () => {
    const gone = (detail.data?.items ?? []).filter((i) => i.checkedAt);
    if (gone.length === 0) return;
    outbox.enqueue({ kind: "clearChecked", listId: id });
    toast({
      message: `${gone.length} comprados eliminados`, actionLabel: "Deshacer",
      onAction: () => outbox.enqueue({ kind: "restoreItems", listId: id, items: gone }),
    });
  };

  const items = detail.data?.items ?? [];
  const editing = items.find((i) => i.id === editingId) ?? null;
  const categories = cats.data?.categories ?? [];
  const stores = useStores();
  const { store: prefStore } = useSelectedStore(stores);
  const pricing = usePricing(items, prefStore?.id ?? null);

  const { groups, done, total, checked } = useMemo(() => {
    const visible = filter === "mine" ? items.filter((i) => i.assigneeId === user?.id) : items;
    const pending = visible.filter((i) => !i.checkedAt);
    return {
      groups: categories.map((c) => ({ cat: c, items: pending.filter((i) => i.categoryId === c.id) })).filter((g) => g.items.length),
      done: visible.filter((i) => i.checkedAt).sort((a, b) => b.checkedAt! - a.checkedAt!),
      total: items.length,
      checked: items.filter((i) => i.checkedAt).length,
    };
  }, [items, categories, filter, user?.id]);

  if (detail.notFound) {
    return (
      <EmptyState emoji="🫥" title="No encuentro esta lista" text="Puede que la hayan eliminado.">
        <Link to="/" className="font-bold text-primary">Volver a las listas</Link>
      </EmptyState>
    );
  }
  if (detail.isError || (cats.isError && !cats.data)) {
    return (
      <EmptyState emoji="📵" title="Esta lista no está en el móvil" text="Ábrela una vez con conexión y después podrás usarla sin ella.">
        <Link to="/" className="font-bold text-primary">Volver a las listas</Link>
      </EmptyState>
    );
  }
  if (!detail.data || !cats.data) return <Spinner />;

  const list = detail.data.list;
  const complete = total > 0 && checked === total;
  const empty = groups.length === 0 && done.length === 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-20 bg-bg/90 px-3 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-1">
          <Link to="/" aria-label="Volver a las listas" className="grid size-12 place-items-center rounded-full hover:bg-surface-2"><CaretLeft size={24} weight="bold" /></Link>
          <span className="text-3xl" aria-hidden>{list.emoji}</span>
          <h1 className="min-w-0 flex-1 truncate pl-1 font-display text-2xl font-semibold">{list.name}</h1>
          {list.template && <span className="rounded-full bg-mustard/25 px-3 py-1 text-xs font-bold uppercase tracking-wide">Plantilla</span>}
          <IconButton label="Opciones de la lista" onClick={() => setOptions(true)}><DotsThreeVertical size={24} weight="bold" /></IconButton>
        </div>
        <div className="px-3">
          <div className="mb-1 flex justify-between text-sm text-muted">
            <span>
              {total === 0 ? "Sin productos" : `${checked} de ${total} en el carro`}
              {detail.pending > 0 && <span className="font-bold text-primary"> · {detail.pending} sin enviar</span>}
            </span>
            <span className="font-bold">{total ? Math.round((checked / total) * 100) : 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={checked} aria-valuemax={total} aria-label="Progreso de la compra">
            <motion.div className={cn("h-full rounded-full", complete ? "bg-sage" : "bg-primary")} initial={false}
              animate={{ width: total ? `${(checked / total) * 100}%` : 0 }} transition={{ type: "spring", stiffness: 140, damping: 22 }} />
          </div>
          {!list.template && pricing.estimate && pricing.estimate.priced > 0 && pricing.store && (
            <Link to={`/listas/${id}/precios`}
              className="mt-2 flex min-h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm transition active:scale-[0.98]"
              aria-label={`Coste estimado ${formatEuro(pricing.estimate.total)} en ${pricing.store.name}. Comparar precios`}>
              <CurrencyEur size={18} weight="duotone" className="text-primary" aria-hidden />
              <span><strong>≈ {formatEuro(pricing.estimate.total)}</strong> en {pricing.store.name}</span>
              <span className="text-muted">· {pricing.estimate.priced} de {pricing.estimate.count} con precio</span>
            </Link>
          )}
          <div className="mt-2 empty:hidden"><Shoppers listId={id} /></div>
          {members.length > 1 && (
            <div className="mt-3 flex gap-2" role="tablist" aria-label="Filtro">
              {([["all", "Todo"], ["mine", "Lo mío"]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  className={cn("min-h-9 rounded-full px-4 text-sm font-bold transition", filter === k ? "bg-ink text-bg" : "bg-surface-2 text-muted")}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 px-4 pb-6 pt-2">
        <AnimatePresence>
          {complete && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mb-4 flex items-center gap-3 rounded-card bg-sage/15 p-4">
                <span className="text-3xl" aria-hidden>🎉</span>
                <p className="flex-1 font-bold">¡Compra completa! No falta nada.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!list.template && <SuggestionChips listId={id} items={items} />}

        {empty && (
          <EmptyState
            emoji={filter === "mine" ? "🙌" : "📝"}
            title={filter === "mine" ? "Nada asignado a ti" : "Lista vacía"}
            text={filter === "mine" ? "Cuando te asignen productos aparecerán aquí." : "Escribe abajo lo que falta en casa. Puedes poner varias cosas separadas por comas."}
          />
        )}

        {groups.map(({ cat, items: gi }) => {
          const Icon = categoryIcon(cat.key);
          return (
            <section key={cat.id} className="mb-5" aria-label={cat.name}>
              <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wide text-muted">
                <Icon size={18} weight="duotone" className="text-primary" aria-hidden />{cat.name}<span className="font-normal">· {gi.length}</span>
              </h2>
              <ItemGroup items={gi} members={members} onToggle={toggle} onEdit={(i) => setEditingId(i.id)} reorderable={filter === "all"} onMove={move} />
            </section>
          );
        })}

        {done.length > 0 && (
          <section className="mb-5" aria-label="Comprados">
            <div className="mb-2 flex items-center justify-between px-1">
              <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
                <CaretDown size={16} weight="bold" className={cn("transition", !showDone && "-rotate-90")} aria-hidden />En el carro · {done.length}
              </button>
              <button onClick={clearChecked} className="min-h-10 px-2 text-sm font-bold text-primary">Vaciar comprados</button>
            </div>
            {showDone && (
              <ul className="flex flex-col gap-2 opacity-75">
                <AnimatePresence initial={false}>
                  {done.map((it) => <ItemRow key={it.id} item={it} members={members} onToggle={toggle} onEdit={(i) => setEditingId(i.id)} spacer={filter === "all"} />)}
                </AnimatePresence>
              </ul>
            )}
          </section>
        )}
      </div>

      <AddBar listId={id} categories={categories} />
      <ItemSheet item={editing} categories={categories} members={members} listId={id} onClose={() => setEditingId(null)} />
      <OptionsSheet list={list} open={options} onClose={() => setOptions(false)} />
    </div>
  );
}
