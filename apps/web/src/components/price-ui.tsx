import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CurrencyEur, Trash } from "@phosphor-icons/react";
import { CHAIN_NAMES, formatEuro, formatUnitPrice, stem, type Item, type Store } from "@compra/shared";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { usePriceBook, useStores } from "../lib/data";
import { ago, euroField, parseEuro } from "../lib/money";
import { Button, Field, Sheet } from "./ui";
import { useToast } from "./toast";

// ---------- Cuánto has pagado (modo tienda) ----------
export function PriceSheet({ item, estimate, hasStore, onSave, onClose }: {
  item: Item | null;
  /** Precio estimado según el libro, si lo hay. */
  estimate: number | null;
  hasStore: boolean;
  onSave: (price: number | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [shownId, setShownId] = useState<string | null>(null);
  if (item && item.id !== shownId) { setShownId(item.id); setText(euroField(item.price)); }

  const value = parseEuro(text);
  const submit = () => { if (value !== null) onSave(value); };

  return (
    <Sheet open={!!item} onClose={onClose} title="¿Cuánto has pagado?">
      {item && (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <p className="text-muted">
            <strong className="text-ink">{item.name}</strong>
            {item.qty !== 1 || item.unit ? ` · ${item.qty}${item.unit ? ` ${item.unit}` : ""}` : ""}
          </p>
          <Field
            label="Importe de la línea (€)" inputMode="decimal" autoFocus autoComplete="off" placeholder="0,00"
            value={text} onChange={(e) => setText(e.target.value)}
            error={text && value === null ? "Escribe un importe, por ejemplo 2,99" : undefined}
          />
          {estimate !== null && (
            <button type="button" onClick={() => setText(euroField(estimate))}
              className="self-start rounded-full bg-surface-2 px-4 py-2 text-sm font-bold text-muted transition active:scale-95">
              Usar el precio habitual: ≈ {formatEuro(estimate)}
            </button>
          )}
          {!hasStore && (
            <p className="rounded-2xl bg-mustard/20 p-3 text-sm">
              Elige tu tienda arriba («Orden por defecto») para que este precio cuente en el comparador. Si no, solo se guarda en la línea.
            </p>
          )}
          <Button type="submit" disabled={value === null}><CurrencyEur size={20} aria-hidden /> Guardar precio</Button>
          {item.price !== null && <Button type="button" variant="ghost" onClick={() => onSave(null)}>Quitar el precio</Button>}
        </form>
      )}
    </Sheet>
  );
}

// ---------- Precios por tienda (ficha del producto) ----------
const UNITS_UI = [["ud", "unidad"], ["kg", "kg"], ["g", "g"], ["l", "l"], ["ml", "ml"]] as const;

function StorePriceRow({ store, name, qty, unit }: { store: Store; name: string; qty: number; unit: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const book = usePriceBook();
  const st = stem(name);
  const entry = book.find((e) => e.stem === st && e.storeId === store.id);

  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState("");
  const [per, setPer] = useState(String(qty));
  const [u, setU] = useState<string>(unit && unit !== "pack" ? unit : "ud");
  useEffect(() => { if (!editing) { setPer(String(qty)); setU(unit && unit !== "pack" ? unit : "ud"); } }, [qty, unit, editing]);

  const done = () => { setEditing(false); qc.invalidateQueries({ queryKey: ["prices"] }); };
  const fail = (e: Error) => toast({ message: e.message, tone: "error" });
  const save = useMutation({
    mutationFn: () => api.setPrice({ name, storeId: store.id, price: parseEuro(price)!, qty: Number(per.replace(",", ".")) || 1, unit: (u === "ud" ? null : u) as never }),
    onSuccess: done, onError: fail,
  });
  const remove = useMutation({ mutationFn: () => api.deletePrice(st, store.id), onSuccess: done, onError: fail });

  const ok = parseEuro(price) !== null && Number(per.replace(",", ".")) > 0;

  return (
    <li className="rounded-2xl bg-surface-2 p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{store.name}</p>
          {entry ? (
            <p className="text-sm text-muted">
              <span className="font-bold text-ink">{formatEuro(entry.price)}</span>
              {entry.unitPrice != null && entry.refUnit && entry.refUnit !== "ud" && <> · {formatUnitPrice(entry)}</>}
              {" · "}{ago(entry.updatedAt)}{!entry.confirmed && " · sugerido"}
            </p>
          ) : (
            <p className="text-sm text-muted">{store.chain && CHAIN_NAMES[store.chain] !== store.name ? `${CHAIN_NAMES[store.chain]} · ` : ""}sin precio</p>
          )}
        </div>
        {!editing && (
          <Button variant="ghost" type="button" className="min-h-10 px-4 text-sm"
            onClick={() => { setPrice(euroField(entry ? entry.price * (Number(per) || 1) : null)); setEditing(true); }}>
            {entry ? "Editar" : "Apuntar"}
          </Button>
        )}
      </div>

      {editing && (
        // No es un <form>: la ficha del producto ya lo es y no se pueden anidar. Enter guarda solo este precio.
        <div
          role="group" aria-label={`Precio en ${store.name}`} className="mt-3 flex flex-col gap-3"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (ok) save.mutate(); } }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Precio (€)" inputMode="decimal" placeholder="0,00" className="w-28" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
            <span className="pb-3 text-muted">por</span>
            <Field label="Cantidad" inputMode="decimal" className="w-20" value={per} onChange={(e) => setPer(e.target.value)} />
            <div>
              <label className="mb-1.5 block text-sm font-bold text-muted" htmlFor={`u-${store.id}`}>Unidad</label>
              <select id={`u-${store.id}`} value={u} onChange={(e) => setU(e.target.value)}
                className="min-h-12 rounded-2xl border border-line bg-surface px-3 text-base outline-none focus:border-primary">
                {UNITS_UI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={() => save.mutate()} disabled={!ok || save.isPending}>Guardar</Button>
            {entry && <Button type="button" variant="danger" onClick={() => remove.mutate()} aria-label={`Quitar el precio en ${store.name}`}><Trash size={18} /></Button>}
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function PriceSection({ name, qty, unit }: { name: string; qty: number; unit: string | null }) {
  const stores = useStores();
  if (!stores) return null;
  return (
    <div>
      <p className="mb-1.5 text-sm font-bold text-muted">Precios</p>
      {stores.length === 0 ? (
        <p className={cn("rounded-2xl bg-surface-2 p-3 text-sm text-muted")}>Crea tus tiendas en Ajustes → «Tiendas y pasillos» para apuntar y comparar precios.</p>
      ) : (
        <ul className="flex flex-col gap-2">{stores.map((s) => <StorePriceRow key={s.id} store={s} name={name} qty={qty} unit={unit} />)}</ul>
      )}
    </div>
  );
}
