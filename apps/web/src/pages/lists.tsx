import { useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, CaretRight, Copy, Plus } from "@phosphor-icons/react";
import type { ListSummary } from "@compra/shared";
import { useAuth } from "../lib/auth";
import { Button, EmojiPicker, EmptyState, Field, Sheet, Spinner, ProgressRing } from "../components/ui";
import { api } from "../lib/api";
import { useLists, useTemplates } from "../lib/data";
import { uuid } from "../lib/id";
import { outbox } from "../lib/outbox";
import { Shoppers } from "../components/presence";
import { useToast } from "../components/toast";
import { cn } from "../lib/cn";

function ListCard({ list, index }: { list: ListSummary; index: number }) {
  const pending = list.total - list.checked;
  const done = list.total > 0 && pending === 0;
  return (
    <motion.li
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04, type: "spring", stiffness: 300, damping: 26 }}
    >
      <Link
        to={`/listas/${list.id}`}
        className="flex items-center gap-4 rounded-card bg-surface p-4 shadow-card transition active:scale-[0.98]"
      >
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-surface-2 text-3xl" aria-hidden>{list.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-xl font-semibold">{list.name}</span>
          <span className={cn("block text-sm", done ? "font-bold text-sage" : "text-muted")}>
            {list.total === 0 ? "Vacía" : done ? "¡Todo comprado!" : `${pending} por comprar · ${list.checked} en el carro`}
          </span>
          <span className="mt-1 block empty:hidden"><Shoppers listId={list.id} /></span>
        </span>
        {list.total > 0 && <ProgressRing value={list.checked / list.total} />}
        <CaretRight size={18} className="text-muted" aria-hidden />
      </Link>
    </motion.li>
  );
}

function TemplateCard({ list }: { list: ListSummary }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const use = useMutation({
    mutationFn: () => api.duplicateList(list.id),
    onSuccess: ({ list: l }) => { qc.invalidateQueries({ queryKey: ["lists"] }); navigate(`/listas/${l.id}`); },
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });
  return (
    <li className="flex items-center gap-3 rounded-card bg-surface p-3 pl-4 shadow-card">
      <Link to={`/listas/${list.id}`} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`Editar plantilla ${list.name}`}>
        <span className="text-2xl" aria-hidden>{list.emoji}</span>
        <span className="min-w-0">
          <span className="block truncate font-bold">{list.name}</span>
          <span className="block text-sm text-muted">{list.total} {list.total === 1 ? "producto" : "productos"}</span>
        </span>
      </Link>
      <Button variant="soft" className="min-h-11 px-4 text-sm" onClick={() => use.mutate()} disabled={use.isPending} aria-label={`Usar plantilla ${list.name}`}>
        <Copy size={16} aria-hidden /> Usar
      </Button>
    </li>
  );
}

function NewListSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🛒");
  const create = () => {
    if (!name.trim()) return;
    // Se crea al momento (también sin conexión); el servidor la recibe en cuanto pueda.
    outbox.enqueue({ kind: "createList", list: { id: uuid(), name: name.trim(), emoji } });
    setName("");
    setEmoji("🛒");
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nueva lista">
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <Field label="Nombre" placeholder="Súper semanal" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
        <div>
          <p className="mb-1.5 text-sm font-bold text-muted">Icono</p>
          <EmojiPicker value={emoji} onChange={setEmoji} />
        </div>
        <Button type="submit" disabled={!name.trim()}>Crear lista</Button>
      </form>
    </Sheet>
  );
}

export function ListsPage() {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const templates = useTemplates(showTemplates);
  const lists = useLists(false);
  const archived = useLists(true, showArchived);

  return (
    <div className="px-5 pb-10 pt-8 md:px-10">
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="text-muted">Hola, {user?.name} 👋</p>
          <h1 className="font-display text-4xl font-semibold leading-tight">Vuestras listas</h1>
        </div>
        <Button onClick={() => setCreating(true)} className="max-md:hidden"><Plus size={20} weight="bold" /> Nueva lista</Button>
      </header>

      {lists.isPending ? <Spinner /> : !lists.lists || lists.lists.length === 0 ? (
        <EmptyState emoji="🧺" title="Aún no hay listas" text="Crea la primera y empezad a llenarla entre todos.">
          <Button onClick={() => setCreating(true)}><Plus size={20} weight="bold" /> Crear lista</Button>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {lists.lists!.map((l, i) => <ListCard key={l.id} list={l} index={i} />)}
        </ul>
      )}

      <button
        onClick={() => setShowTemplates((v) => !v)}
        className="mt-8 flex items-center gap-2 text-sm font-bold text-muted"
        aria-expanded={showTemplates}
      >
        <Copy size={18} /> {showTemplates ? "Ocultar plantillas" : "Ver plantillas"}
      </button>
      {showTemplates && (
        templates.isPending ? <Spinner /> : !templates.templates || templates.templates.length === 0
          ? <p className="mt-3 text-sm text-muted">Aún no hay plantillas. En «Opciones» de una lista puedes guardarla como plantilla.</p>
          : <ul className="mt-3 flex flex-col gap-2">{templates.templates.map((t) => <TemplateCard key={t.id} list={t} />)}</ul>
      )}

      <button
        onClick={() => setShowArchived((v) => !v)}
        className="mt-6 flex items-center gap-2 text-sm font-bold text-muted"
        aria-expanded={showArchived}
      >
        <Archive size={18} /> {showArchived ? "Ocultar archivadas" : "Ver archivadas"}
      </button>
      {showArchived && (
        archived.isPending ? <Spinner /> : !archived.lists || archived.lists.length === 0
          ? <p className="mt-3 text-sm text-muted">No hay listas archivadas.</p>
          : <ul className="mt-3 grid gap-3 opacity-80 md:grid-cols-2">{archived.lists!.map((l, i) => <ListCard key={l.id} list={l} index={i} />)}</ul>
      )}

      <button
        onClick={() => setCreating(true)}
        aria-label="Nueva lista"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-5 z-30 grid size-16 place-items-center rounded-full bg-primary text-on-primary shadow-card transition active:scale-90 md:hidden"
      >
        <Plus size={30} weight="bold" />
      </button>
      <NewListSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
