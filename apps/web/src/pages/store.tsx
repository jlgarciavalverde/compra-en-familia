import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CaretDown, CaretLeft, Check, MapPin, Storefront } from "@phosphor-icons/react";
import { bookIndex, estimateList, formatEuro, paidTotal, type Item } from "@compra/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { categoryIcon } from "../lib/categories";
import { cn } from "../lib/cn";
import { useCategories, useListDetail, useLists, usePriceBook, useStores } from "../lib/data";
import { outbox } from "../lib/outbox";
import { presence, usePresence } from "../lib/presence";
import { useSelectedStore } from "../lib/store-pref";
import { useWakeLock } from "../lib/wakelock";
import { Shoppers } from "../components/presence";
import { useToast } from "../components/toast";
import { Avatar, Button, EmptyState, ProgressRing, Sheet, Spinner } from "../components/ui";
import { PriceSheet } from "../components/price-ui";
import { ItemRow, ItemSheet } from "./list";

// ---------- Elegir qué lista comprar ----------
export function ShopPickPage() {
  const { household } = useAuth();
  const { lists, isPending } = useLists(false);
  const shopping = usePresence();
  const pending = (lists ?? []).filter((l) => l.total - l.checked > 0);

  return (
    <div className="px-5 pb-10 pt-8 md:px-10">
      <header className="mb-7">
        <p className="text-muted">Modo tienda</p>
        <h1 className="font-display text-4xl font-semibold leading-tight">¿Qué vas a comprar?</h1>
      </header>

      {isPending ? <Spinner /> : pending.length === 0 ? (
        <EmptyState emoji="🎉" title="No hay nada pendiente" text="Cuando alguien añada productos a una lista, podrás salir a comprarlos desde aquí.">
          <Link to="/" className="font-bold text-primary">Ir a las listas</Link>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {pending.map((l) => {
            const people = shopping.filter((p) => p.listId === l.id).map((p) => household?.members.find((m) => m.id === p.userId)).filter(Boolean);
            return (
              <li key={l.id}>
                <Link to={`/comprar/${l.id}`} className="flex items-center gap-4 rounded-card bg-surface p-4 shadow-card transition active:scale-[0.98]">
                  <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-surface-2 text-3xl" aria-hidden>{l.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-xl font-semibold">{l.name}</span>
                    <span className="block text-sm text-muted">{l.total - l.checked} por comprar</span>
                    {people.length > 0 && (
                      <span className="mt-1 flex items-center gap-1.5 text-sm font-bold text-sage">
                        <span className="flex -space-x-2">{people.map((p) => <Avatar key={p!.id} user={p!} size={20} ring />)}</span>
                        comprando ahora
                      </span>
                    )}
                  </span>
                  <span className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary">Empezar</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- Modo tienda ----------
export function StorePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user, household } = useAuth();
  const members = household?.members ?? [];

  const detail = useListDetail(id);
  const cats = useCategories();
  const stores = useStores();
  const { store, choose } = useSelectedStore(stores);

  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickStore, setPickStore] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Desplegado por defecto: ahí está el botón «+ precio» de lo que acabas de meter en el carro.
  const [showDone, setShowDone] = useState(true);
  const [pricingId, setPricingId] = useState<string | null>(null);

  // Pantalla encendida y "estoy comprando" visible para el resto mientras dure.
  useWakeLock(true);
  useEffect(() => {
    presence.announce(id);
    return () => presence.announce(null);
  }, [id]);

  const items = detail.data?.items ?? [];
  const categories = cats.data?.categories ?? [];
  // Al marcar se apunta también en qué tienda se compra: alimenta el historial de esa tienda.
  const toggle = (it: Item) => {
    outbox.enqueue({ kind: "updateItem", listId: id, itemId: it.id, patch: { checked: !it.checkedAt, storeId: store?.id } });
    // Al meter algo en el carro, ofrece apuntar el precio con un toque.
    if (!it.checkedAt && it.price == null) {
      toast({ message: `${it.name} en el carro`, actionLabel: "+ precio", onAction: () => setPricingId(it.id) });
    }
  };

  const book = usePriceBook();
  const index = useMemo(() => bookIndex(book), [book]);
  const estimate = useMemo(
    () => (store ? estimateList(items.filter((i) => !i.checkedAt), index, store.id) : null),
    [store, items, index],
  );
  const costOf = useMemo(() => new Map((estimate?.lines ?? []).map((l) => [l.itemId, l.cost])), [estimate]);
  const paid = paidTotal(items);
  const savePrice = (price: number | null) => {
    if (!pricingId) return;
    outbox.enqueue({ kind: "updateItem", listId: id, itemId: pricingId, patch: { price, storeId: store?.id } });
    setPricingId(null);
  };

  const { groups, done, total, checked } = useMemo(() => {
    const visible = filter === "mine" ? items.filter((i) => i.assigneeId === user?.id) : items;
    const pending = visible.filter((i) => !i.checkedAt);
    const byId = new Map(categories.map((c) => [c.id, c]));
    // El orden de los pasillos es el de la tienda elegida (o el de por defecto).
    const order = store?.order ?? categories.map((c) => c.id);
    return {
      groups: order.map((cid) => byId.get(cid)).filter((c): c is NonNullable<typeof c> => !!c)
        .map((cat) => ({ cat, items: pending.filter((i) => i.categoryId === cat.id) }))
        .filter((g) => g.items.length),
      done: visible.filter((i) => i.checkedAt).sort((a, b) => b.checkedAt! - a.checkedAt!),
      total: items.length,
      checked: items.filter((i) => i.checkedAt).length,
    };
  }, [items, categories, filter, store, user?.id]);

  if (detail.notFound) {
    return (
      <EmptyState emoji="🫥" title="No encuentro esta lista" text="Puede que la hayan eliminado.">
        <Link to="/comprar" className="font-bold text-primary">Volver</Link>
      </EmptyState>
    );
  }
  if (detail.isError || (cats.isError && !cats.data)) {
    return (
      <EmptyState emoji="📵" title="Esta lista no está en el móvil" text="Ábrela una vez con conexión y después podrás usarla sin ella.">
        <Link to="/comprar" className="font-bold text-primary">Volver</Link>
      </EmptyState>
    );
  }
  if (!detail.data || !cats.data) return <Spinner />;

  const list = detail.data.list;
  const pendingCount = total - checked;
  const complete = total > 0 && pendingCount === 0;
  const editing = items.find((i) => i.id === editingId) ?? null;

  const finish = (archive: boolean) => {
    outbox.enqueue({ kind: "clearChecked", listId: id });
    setFinishing(false);
    if (archive) {
      api.updateList(id, { archived: true })
        .then(() => qc.invalidateQueries({ queryKey: ["lists"] }))
        .catch((e: Error) => toast({ message: `No se pudo archivar: ${e.message}`, tone: "error" }));
    }
    toast({ message: `Compra terminada · ${checked} ${checked === 1 ? "producto" : "productos"} 🎉` });
    navigate("/comprar", { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-20 bg-bg/90 px-3 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-1">
          <Link to="/comprar" aria-label="Salir del modo tienda" className="grid size-12 place-items-center rounded-full hover:bg-surface-2"><CaretLeft size={24} weight="bold" /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl font-semibold"><span aria-hidden>{list.emoji} </span>{list.name}</h1>
            <p className="text-sm text-muted">{complete ? "¡Todo en el carro!" : `${pendingCount} por comprar · ${checked} en el carro`}</p>
            {((estimate && estimate.priced > 0) || paid.count > 0) && (
              <p className="text-sm">
                {estimate && estimate.priced > 0 && !complete && <span>Faltan <strong>≈ {formatEuro(estimate.total)}</strong></span>}
                {estimate && estimate.priced > 0 && !complete && paid.count > 0 && <span className="text-muted"> · </span>}
                {paid.count > 0 && <span>Pagado <strong>{formatEuro(paid.total)}</strong></span>}
              </p>
            )}
          </div>
          <ProgressRing value={total ? checked / total : 0} size={52} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
          <button
            onClick={() => setPickStore(true)}
            className="flex min-h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-bold"
          >
            <Storefront size={18} weight="duotone" aria-hidden /> {store ? store.name : "Orden por defecto"} <CaretDown size={14} weight="bold" aria-hidden />
          </button>
          {members.length > 1 && (
            <div className="flex gap-1.5" role="tablist" aria-label="Filtro">
              {([["all", "Todo"], ["mine", "Lo mío"]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  className={cn("min-h-10 rounded-full px-4 text-sm font-bold transition", filter === k ? "bg-ink text-bg" : "bg-surface-2 text-muted")}>{label}</button>
              ))}
            </div>
          )}
          <Shoppers listId={id} />
        </div>
      </header>

      <div className="flex-1 px-4 pb-32 pt-2">
        {complete && (
          <div className="mb-4 flex items-center gap-3 rounded-card bg-sage/15 p-4">
            <span className="text-3xl" aria-hidden>🎉</span>
            <p className="flex-1 font-bold">¡Compra completa! Ya puedes terminar.</p>
          </div>
        )}
        {groups.length === 0 && done.length === 0 && (
          <EmptyState emoji={filter === "mine" ? "🙌" : "📝"} title={filter === "mine" ? "Nada asignado a ti" : "Lista vacía"} text="No hay nada que comprar aquí." />
        )}

        {groups.map(({ cat, items: gi }, n) => {
          const Icon = categoryIcon(cat.key);
          return (
            <section key={cat.id} className="mb-6" aria-label={cat.name}>
              <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wide text-muted">
                <span className="grid size-6 place-items-center rounded-full bg-primary text-xs text-on-primary" aria-hidden>{n + 1}</span>
                <Icon size={18} weight="duotone" className="text-primary" aria-hidden />{cat.name}<span className="font-normal">· {gi.length}</span>
              </h2>
              <ul className="flex flex-col gap-2.5">
                <AnimatePresence initial={false}>
                  {gi.map((it) => <ItemRow key={it.id} item={it} members={members} onToggle={toggle} onEdit={(i) => setEditingId(i.id)} onPrice={(i) => setPricingId(i.id)} estimate={costOf.get(it.id) ?? null} large />)}
                </AnimatePresence>
              </ul>
            </section>
          );
        })}

        {done.length > 0 && (
          <section className="mb-5" aria-label="Comprados">
            <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="mb-2 flex min-h-10 items-center gap-2 px-1 text-sm font-bold uppercase tracking-wide text-muted">
              <CaretDown size={16} weight="bold" className={cn("transition", !showDone && "-rotate-90")} aria-hidden />En el carro · {done.length}
            </button>
            {showDone && (
              <ul className="flex flex-col gap-2 opacity-75">
                <AnimatePresence initial={false}>
                  {done.map((it) => <ItemRow key={it.id} item={it} members={members} onToggle={toggle} onEdit={(i) => setEditingId(i.id)} onPrice={(i) => setPricingId(i.id)} large />)}
                </AnimatePresence>
              </ul>
            )}
          </section>
        )}
      </div>

      <AnimatePresence>
        {checked > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            className="fixed inset-x-0 bottom-0 z-30 flex justify-center bg-gradient-to-t from-bg from-60% to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-8"
          >
            <Button onClick={() => setFinishing(true)} className="min-h-14 w-full max-w-md text-lg shadow-card">
              <Check size={22} weight="bold" /> Terminar compra · {checked}/{total}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet open={pickStore} onClose={() => setPickStore(false)} title="¿En qué tienda estás?">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Tienda">
          {[null, ...(stores ?? [])].map((s) => (
            <button key={s?.id ?? "default"} role="radio" aria-checked={store?.id === (s?.id ?? undefined) || (!store && !s)}
              onClick={() => { choose(s?.id ?? null); setPickStore(false); }}
              className={cn("flex min-h-14 items-center gap-3 rounded-2xl px-4 text-left font-bold transition",
                (store?.id ?? null) === (s?.id ?? null) ? "bg-primary/15 text-primary ring-2 ring-primary" : "bg-surface-2")}>
              {s ? <MapPin size={22} weight="duotone" aria-hidden /> : <Storefront size={22} weight="duotone" aria-hidden />}
              {s ? s.name : "Orden por defecto"}
            </button>
          ))}
          <p className="mt-2 text-sm text-muted">
            Cada tienda ordena los pasillos como está montada. Créalas y ordénalas en <Link to="/ajustes" className="font-bold text-primary">Ajustes</Link>.
          </p>
        </div>
      </Sheet>

      <Sheet open={finishing} onClose={() => setFinishing(false)} title="Terminar compra">
        <div className="flex flex-col gap-3">
          <p>
            Has comprado <strong>{checked}</strong> {checked === 1 ? "producto" : "productos"}{paid.count > 0 && <> ({formatEuro(paid.total)} apuntados)</>}
            {pendingCount > 0 ? <>; quedan <strong>{pendingCount}</strong> pendientes en la lista.</> : "; no queda nada pendiente."}
          </p>
          <p className="text-sm text-muted">Los comprados salen de la lista y quedan guardados en el historial.</p>
          <Button onClick={() => finish(false)}>Terminar y vaciar comprados</Button>
          {complete && <Button variant="soft" onClick={() => finish(true)}>Terminar y archivar la lista</Button>}
          <Button variant="ghost" onClick={() => setFinishing(false)}>Seguir comprando</Button>
        </div>
      </Sheet>

      <PriceSheet
        item={items.find((i) => i.id === pricingId) ?? null}
        estimate={pricingId ? costOf.get(pricingId) ?? null : null}
        hasStore={!!store} onSave={savePrice} onClose={() => setPricingId(null)}
      />
      <ItemSheet item={editing} categories={categories} members={members} listId={id} onClose={() => setEditingId(null)} />
    </div>
  );
}
