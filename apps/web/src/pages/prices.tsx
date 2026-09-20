import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { motion } from "motion/react";
import { CaretLeft, Crown, Lightbulb } from "@phosphor-icons/react";
import { CHAIN_NAMES, bookIndex, compareStores, formatEuro, type Store } from "@compra/shared";
import { cn } from "../lib/cn";
import { useListDetail, usePriceBook, useStores } from "../lib/data";
import { EmptyState, Spinner } from "../components/ui";

export function ComparePage() {
  const { id = "" } = useParams();
  const detail = useListDetail(id);
  const stores = useStores();
  const book = usePriceBook();
  const index = useMemo(() => bookIndex(book), [book]);
  const pending = useMemo(() => (detail.data?.items ?? []).filter((i) => !i.checkedAt), [detail.data]);
  const cmp = useMemo(() => compareStores(pending, index, (stores ?? []).map((s) => s.id)), [pending, index, stores]);

  if (detail.notFound) {
    return <EmptyState emoji="🫥" title="No encuentro esta lista" text="Puede que la hayan eliminado."><Link to="/" className="font-bold text-primary">Volver</Link></EmptyState>;
  }
  if (!detail.data || !stores) return detail.isError ? (
    <EmptyState emoji="📵" title="Esta lista no está en el móvil" text="Ábrela una vez con conexión."><Link to="/" className="font-bold text-primary">Volver</Link></EmptyState>
  ) : <Spinner />;

  const list = detail.data.list;
  const byId = new Map<string, Store>(stores.map((s) => [s.id, s]));
  const name = (sid: string) => byId.get(sid)?.name ?? "Tienda";
  const withData = cmp.stores.filter((s) => s.total !== null).sort((a, b) => a.total! - b.total!);
  const noData = cmp.stores.filter((s) => s.total === null);
  const maxTotal = Math.max(...withData.map((s) => s.total!), 0.01);
  const rows = [...cmp.rows].sort((a, b) => (b.saving ?? -1) - (a.saving ?? -1));
  const cols = withData.map((s) => s.storeId);
  const second = withData.at(-1);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-3">
      <header className="mb-5 flex items-center gap-1">
        <Link to={`/listas/${id}`} aria-label="Volver a la lista" className="grid size-12 place-items-center rounded-full hover:bg-surface-2"><CaretLeft size={24} weight="bold" /></Link>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold">Comparar precios</h1>
          <p className="truncate text-sm text-muted"><span aria-hidden>{list.emoji} </span>{list.name} · {pending.length} por comprar</p>
        </div>
      </header>

      {stores.length === 0 ? (
        <EmptyState emoji="🏪" title="Primero, tus tiendas" text="Crea Mercadona, Family Cash, Super Dumbo… para poder apuntar y comparar sus precios.">
          <Link to="/ajustes" className="font-bold text-primary">Ir a Ajustes</Link>
        </EmptyState>
      ) : withData.length === 0 ? (
        <EmptyState emoji="🧾" title="Aún no hay precios de esta lista" text="Al comprar en modo tienda, apunta lo que pagas por cada producto (botón «+ precio»). También puedes apuntarlos desde la ficha de cada producto. Con dos tiendas con datos verás aquí cuál sale más barata.">
          <Link to="/comprar" className="font-bold text-primary">Ir al modo tienda</Link>
        </EmptyState>
      ) : (
        <>
          {cmp.cheapestStoreId && second && (
            <p className="mb-4 rounded-card bg-sage/15 p-4">
              <Crown size={20} weight="fill" className="mr-1.5 inline text-sage" aria-hidden />
              Con los <strong>{cmp.comparable}</strong> productos que tienen precio en todas, <strong>{name(cmp.cheapestStoreId)}</strong> sale{" "}
              <strong>{formatEuro(cmp.gap)}</strong> más barata que {name(second.storeId)}.
            </p>
          )}

          <ul className="mb-4 flex flex-col gap-3" aria-label="Total por tienda">
            {withData.map((s, i) => {
              const best = cmp.cheapestStoreId === s.storeId;
              const store = byId.get(s.storeId);
              return (
                <li key={s.storeId} className="rounded-card bg-surface p-4 shadow-card">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-bold">
                        {store?.name}
                        {best && <span className="rounded-full bg-sage px-2 py-0.5 text-xs font-bold text-on-primary">Más barata</span>}
                      </p>
                      <p className="text-sm text-muted">
                        {store?.chain && CHAIN_NAMES[store.chain] !== store.name ? `${CHAIN_NAMES[store.chain]} · ` : ""}{s.priced} de {pending.length} con precio
                        {s.unconfirmed > 0 && ` · ${s.unconfirmed} sugeridos`}
                      </p>
                    </div>
                    <p className="font-display text-3xl font-semibold tabular-nums">{formatEuro(s.total!)}</p>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-line" aria-hidden>
                    <motion.div
                      className={cn("h-full rounded-full", best ? "bg-sage" : "bg-primary")}
                      initial={{ width: 0 }} animate={{ width: `${(s.total! / maxTotal) * 100}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 20, delay: i * 0.06 }}
                    />
                  </div>
                </li>
              );
            })}
            {noData.map((s) => (
              <li key={s.storeId} className="rounded-card bg-surface-2 p-4 text-muted">
                <p className="font-bold text-ink">{name(s.storeId)}</p>
                <p className="text-sm">Sin precios todavía. Apúntalos al comprar allí.</p>
              </li>
            ))}
          </ul>
          <p className="mb-5 px-1 text-sm text-muted">
            Los totales suman solo los productos con precio en todas las tiendas comparadas, para que la comparación sea justa.
            Son estimaciones con el último precio guardado; no incluyen ofertas.
          </p>

          {cmp.splitSavings > 0 && (
            <div className="mb-6 flex gap-3 rounded-card bg-mustard/15 p-4">
              <Lightbulb size={24} weight="duotone" className="mt-0.5 shrink-0 text-mustard" aria-hidden />
              <p>
                Comprando cada producto donde sale más barato os ahorraríais <strong>{formatEuro(cmp.splitSavings)}</strong> más, a cambio de ir a
                más de una tienda.
              </p>
            </div>
          )}

          <h2 className="mb-2 px-1 font-display text-xl font-semibold">Producto a producto</h2>
          <div className="overflow-x-auto rounded-card bg-surface shadow-card">
            <table className="w-full text-left">
              <thead>
                <tr className="text-sm text-muted">
                  <th className="px-4 py-3 font-bold">Producto</th>
                  {cols.map((c) => <th key={c} className="px-3 py-3 text-right font-bold">{name(c)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.itemId}>
                    <td className="px-4 py-3 font-bold">{r.name}</td>
                    {cols.map((c) => {
                      const v = r.costs[c];
                      const best = r.cheapestStoreId === c;
                      return (
                        <td key={c} className={cn("px-3 py-3 text-right tabular-nums", best ? "font-bold text-sage" : v == null && "text-muted/60")}>
                          {v == null ? "–" : formatEuro(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
