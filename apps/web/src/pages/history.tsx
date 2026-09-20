import { useMemo, useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { formatEuro, type Purchase } from "@compra/shared";
import { useAuth } from "../lib/auth";
import { formatQty } from "../lib/cn";
import { useHistory, useLists } from "../lib/data";
import { uuid } from "../lib/id";
import { outbox } from "../lib/outbox";
import { useToast } from "../components/toast";
import { Avatar, Button, EmptyState, Sheet, Spinner } from "../components/ui";

const DAY = 24 * 3600 * 1000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

function dayLabel(dayStart: number): string {
  const today = startOfDay(Date.now());
  if (dayStart === today) return "Hoy";
  if (dayStart === today - DAY) return "Ayer";
  const s = new Date(dayStart).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return s[0]!.toUpperCase() + s.slice(1);
}

interface Group { key: string; listName: string; purchases: Purchase[] }
interface Day { dayStart: number; groups: Group[] }

/** Agrupa por día y, dentro de cada día, por lista (lo más reciente primero). */
export function groupHistory(purchases: Purchase[]): Day[] {
  const days: Day[] = [];
  for (const p of purchases) {
    const dayStart = startOfDay(p.at);
    let day = days.at(-1);
    if (!day || day.dayStart !== dayStart) days.push((day = { dayStart, groups: [] }));
    let g = day.groups.find((x) => x.listName === p.listName);
    if (!g) day.groups.push((g = { key: `${dayStart}-${p.listName}`, listName: p.listName, purchases: [] }));
    g.purchases.push(p);
  }
  return days;
}

export function HistoryPage() {
  const toast = useToast();
  const { household } = useAuth();
  const [limit, setLimit] = useState(200);
  const history = useHistory(limit);
  const { lists } = useLists(false);
  const [target, setTarget] = useState<Purchase[] | null>(null);

  const days = useMemo(() => groupHistory(history.data?.purchases ?? []), [history.data]);
  const who = (id: string | null) => household?.members.find((m) => m.id === id);

  const addTo = (listId: string, listName: string, purchases: Purchase[]) => {
    const seen = new Set<string>();
    const items = purchases.filter((p) => !seen.has(p.name) && seen.add(p.name))
      .map((p) => ({ id: uuid(), name: p.name, qty: p.qty, unit: p.unit, categoryId: p.categoryId }));
    outbox.enqueue({ kind: "addItems", listId, items });
    setTarget(null);
    toast({ message: `${items.length === 1 ? items[0]!.name : `${items.length} productos`} añadido a «${listName}»` });
  };

  const start = (purchases: Purchase[]) => {
    if (lists?.length === 1) addTo(lists[0]!.id, lists[0]!.name, purchases);
    else setTarget(purchases);
  };

  return (
    <div className="mx-auto max-w-2xl px-5 pb-10 pt-8 md:px-10">
      <header className="mb-7">
        <p className="text-muted">Lo que habéis comprado</p>
        <h1 className="font-display text-4xl font-semibold leading-tight">Historial</h1>
      </header>

      {history.isPending ? <Spinner /> : history.isError && !history.data ? (
        <EmptyState emoji="📵" title="No se puede cargar ahora" text="El historial necesita conexión la primera vez. Inténtalo de nuevo cuando la tengas." />
      ) : days.length === 0 ? (
        <EmptyState emoji="🧾" title="Todavía no hay compras" text="Cuando marquéis productos como comprados, aparecerán aquí para volver a añadirlos con un toque." />
      ) : (
        <>
          {days.map((day) => (
            <section key={day.dayStart} className="mb-7" aria-label={dayLabel(day.dayStart)}>
              <h2 className="mb-3 px-1 font-display text-xl font-semibold">{dayLabel(day.dayStart)}</h2>
              <div className="flex flex-col gap-3">
                {day.groups.map((g) => {
                  const buyers = [...new Set(g.purchases.map((p) => p.userId))].map(who).filter(Boolean);
                  return (
                    <article key={g.key} className="rounded-card bg-surface p-4 shadow-card">
                      <header className="mb-2 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-bold">{g.listName}</h3>
                          <p className="text-sm text-muted">
                            {g.purchases.length} {g.purchases.length === 1 ? "producto" : "productos"}
                            {g.purchases.some((p) => p.price != null) && <> · <strong className="text-ink">{formatEuro(g.purchases.reduce((n, p) => n + (p.price ?? 0), 0))}</strong> apuntados</>}
                          </p>
                        </div>
                        <span className="flex -space-x-2">{buyers.map((b) => <Avatar key={b!.id} user={b!} size={26} ring />)}</span>
                        <Button variant="soft" className="min-h-10 px-4 text-sm" onClick={() => start(g.purchases)} aria-label={`Volver a añadir todo lo de ${g.listName}`}>
                          <Plus size={16} weight="bold" aria-hidden /> Todo
                        </Button>
                      </header>
                      <ul className="divide-y divide-line">
                        {g.purchases.map((p) => {
                          const qty = formatQty(p.qty, p.unit);
                          return (
                            <li key={p.id} className="flex items-center gap-3 py-1">
                              <span className="min-w-0 flex-1 truncate">{p.name}</span>
                              {qty && <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-bold text-muted">{qty}</span>}
                              {p.price != null && <span className="text-sm font-bold tabular-nums">{formatEuro(p.price)}</span>}
                              <button onClick={() => start([p])} aria-label={`Volver a añadir ${p.name}`}
                                className="grid size-11 place-items-center rounded-full text-primary transition hover:bg-surface-2 active:scale-90">
                                <Plus size={20} weight="bold" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {history.data?.hasMore && <Button variant="soft" className="w-full" onClick={() => setLimit((l) => l + 200)}>Ver compras anteriores</Button>}
        </>
      )}

      <Sheet open={!!target} onClose={() => setTarget(null)} title="¿A qué lista?">
        <div className="flex flex-col gap-2">
          {(lists ?? []).map((l) => (
            <button key={l.id} onClick={() => target && addTo(l.id, l.name, target)}
              className="flex min-h-14 items-center gap-3 rounded-2xl bg-surface-2 px-4 text-left font-bold transition active:scale-[0.98]">
              <span className="text-2xl" aria-hidden>{l.emoji}</span>{l.name}
            </button>
          ))}
          {(lists?.length ?? 0) === 0 && <p className="text-muted">Primero crea una lista.</p>}
        </div>
      </Sheet>
    </div>
  );
}
