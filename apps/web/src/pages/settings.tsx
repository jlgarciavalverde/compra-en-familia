import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "motion/react";
import { Check, Copy, DeviceMobile, DotsSixVertical, DownloadSimple, Key, MoonStars, Plus, Share, SignOut, Storefront, Sun, SunHorizon, Trash, UserMinus } from "@phosphor-icons/react";
import { CHAINS, CHAIN_NAMES, type Category, type Chain, type Store } from "@compra/shared";
import { api, downloadExport, PUBLIC_URL } from "../lib/api";
import { useAuth } from "../lib/auth";
import { categoryIcon } from "../lib/categories";
import { useCategories, useStores } from "../lib/data";
import { useInstallPrompt } from "../lib/install";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { cn } from "../lib/cn";
import { useToast } from "../components/toast";
import { AndroidCard, NotificationsCard, SecurityCard } from "../components/account-cards";
import { Avatar, Button, EmojiPicker, Field, PROFILE_COLORS, PROFILE_EMOJIS, Sheet } from "../components/ui";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-card bg-surface p-5 shadow-card">
      <h2 className="mb-4 font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ProfileCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const save = useMutation({
    mutationFn: api.updateMe,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });
  if (!user) return null;
  return (
    <Card title="Tu perfil">
      <div className="mb-5 flex items-center gap-4">
        <Avatar user={user} size={64} />
        <form className="flex flex-1 items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name !== user.name) save.mutate({ name }); }}>
          <Field label="Nombre" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Button type="submit" variant="soft" disabled={!name.trim() || name === user.name}>Guardar</Button>
        </form>
      </div>
      <p className="mb-1.5 text-sm font-bold text-muted">Tu emoji</p>
      <EmojiPicker value={user.avatarEmoji} onChange={(avatarEmoji) => save.mutate({ avatarEmoji })} options={PROFILE_EMOJIS} />
      <p className="mb-1.5 mt-4 text-sm font-bold text-muted">Tu color</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
        {PROFILE_COLORS.map((c) => (
          <button key={c} role="radio" aria-checked={user.avatarColor.toLowerCase() === c.toLowerCase()} aria-label={c}
            onClick={() => save.mutate({ avatarColor: c })}
            className="grid size-11 place-items-center rounded-full transition active:scale-90" style={{ background: c }}>
            {user.avatarColor.toLowerCase() === c.toLowerCase() && <Check size={20} weight="bold" color="#fff" />}
          </button>
        ))}
      </div>
    </Card>
  );
}

function HouseholdCard() {
  const { user, household } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reset, setReset] = useState<{ name: string; link: string } | null>(null);
  const resetAccess = useMutation({
    mutationFn: (m: { id: string; name: string }) => api.resetMember(m.id).then((r) => ({ name: m.name, link: `${PUBLIC_URL}/restablecer/${r.code}` })),
    onSuccess: setReset,
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });
  const remove = useMutation({
    mutationFn: api.removeMember,
    onSuccess: () => { setConfirmId(null); qc.invalidateQueries({ queryKey: ["me"] }); toast({ message: "Ya no forma parte del hogar" }); },
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });
  const invite = useMutation({
    mutationFn: api.createInvite,
    onSuccess: ({ code }) => setLink(`${PUBLIC_URL}/unirse/${code}`),
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });
  const message = link ? `Únete a «${household?.name}» en Compra en Familia: ${link}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link!); toast({ message: "Enlace copiado" }); }
    catch { toast({ message: "No se pudo copiar. Selecciónalo a mano.", tone: "error" }); }
  };

  return (
    <Card title={household?.name ?? "Tu hogar"}>
      <ul className="mb-4 flex flex-col gap-3">
        {household?.members.map((m) => (
          <li key={m.id} className="flex items-center gap-3">
            <Avatar user={m} size={40} />
            <span className="flex-1 font-bold">{m.name}{m.id === user?.id && <span className="font-normal text-muted"> (tú)</span>}</span>
            {confirmId === m.id ? (
              <span className="flex items-center gap-1">
                <Button variant="primary" className="min-h-10 px-4 text-sm" onClick={() => remove.mutate(m.id)} disabled={remove.isPending}>Quitar</Button>
                <Button variant="ghost" className="min-h-10 px-3 text-sm" onClick={() => setConfirmId(null)}>Cancelar</Button>
              </span>
            ) : (
              <>
                <span className="text-sm text-muted">{m.role === "admin" ? "Administrador" : "Miembro"}</span>
                {user?.role === "admin" && m.id !== user.id && (
                  <button onClick={() => resetAccess.mutate({ id: m.id, name: m.name })} aria-label={`Restablecer el acceso de ${m.name}`} title="Restablecer el acceso"
                    className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-surface-2 active:scale-90">
                    <Key size={20} />
                  </button>
                )}
                {user?.role === "admin" && m.id !== user.id && (
                  <button onClick={() => setConfirmId(m.id)} aria-label={`Quitar a ${m.name} del hogar`}
                    className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-surface-2 active:scale-90">
                    <UserMinus size={20} />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <Sheet open={!!reset} onClose={() => setReset(null)} title="Restablecer el acceso">
        {reset && (
          <div className="flex flex-col gap-3">
            <p>Manda este enlace a <strong>{reset.name}</strong> para que elija una contraseña nueva. Sirve una sola vez y caduca en 24 horas.</p>
            <p className="break-all rounded-xl bg-surface-2 p-3 text-sm font-bold" data-testid="reset-link">{reset.link}</p>
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={() => { void navigator.clipboard?.writeText(reset.link).then(() => toast({ message: "Enlace copiado" })); }}><Copy size={20} /> Copiar</Button>
              <a className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary font-bold text-on-primary" target="_blank" rel="noreferrer"
                href={`https://wa.me/?text=${encodeURIComponent(`Enlace para elegir tu nueva contraseña de Compra en Familia: ${reset.link}`)}`}>WhatsApp</a>
            </div>
            <p className="text-sm text-muted">Al usarlo se cerrará la sesión de {reset.name} en todos sus dispositivos.</p>
          </div>
        )}
      </Sheet>
      {user?.role === "admin" && (
        link ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
            <p className="text-sm text-muted">Enlace de un solo uso, válido 7 días:</p>
            <p className="break-all rounded-xl bg-surface p-3 text-sm font-bold" data-testid="invite-link">{link}</p>
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={copy}><Copy size={20} /> Copiar</Button>
              {"share" in navigator ? (
                <Button className="flex-1" onClick={() => navigator.share({ text: message }).catch(() => undefined)}><Share size={20} /> Compartir</Button>
              ) : (
                <a className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary font-bold text-on-primary" target="_blank" rel="noreferrer"
                  href={`https://wa.me/?text=${encodeURIComponent(message)}`}>WhatsApp</a>
              )}
            </div>
          </div>
        ) : (
          <Button variant="soft" className="w-full" onClick={() => invite.mutate()} disabled={invite.isPending}>Invitar a alguien</Button>
        )
      )}
    </Card>
  );
}

function AisleRow({ id, category }: { id: string; category: Category | undefined }) {
  const controls = useDragControls();
  const Icon = categoryIcon(category?.key ?? "otros");
  return (
    <Reorder.Item value={id} dragListener={false} dragControls={controls} whileDrag={{ scale: 1.03 }}
      className="flex items-center gap-3 rounded-2xl bg-surface-2 py-2 pl-2 pr-4">
      <span onPointerDown={(e) => controls.start(e)} role="img" aria-label={`Arrastra para mover ${category?.name}`}
        className="grid size-10 cursor-grab touch-none place-items-center text-muted active:cursor-grabbing">
        <DotsSixVertical size={22} weight="bold" aria-hidden />
      </span>
      <Icon size={22} weight="duotone" className="text-primary" aria-hidden />
      <span className="font-bold">{category?.name}</span>
    </Reorder.Item>
  );
}

/** Editar una tienda: nombre y orden de sus pasillos (el mismo con el que se ordena el modo tienda). */
function StoreSheet({ store, categories, onClose }: { store: Store | null; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [chain, setChain] = useState<Chain | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  if (store && store.id !== shownId) { setShownId(store.id); setName(store.name); setOrder(store.order); setChain(store.chain); setConfirmDelete(false); }

  const done = () => { qc.invalidateQueries({ queryKey: ["stores"] }); onClose(); };
  const save = useMutation({ mutationFn: () => api.updateStore(store!.id, { name, order, chain }), onSuccess: done, onError: (e) => toast({ message: e.message, tone: "error" }) });
  const remove = useMutation({ mutationFn: () => api.deleteStore(store!.id), onSuccess: done, onError: (e) => toast({ message: e.message, tone: "error" }) });
  const byId = new Map(categories.map((c) => [c.id, c]));

  return (
    <Sheet open={!!store} onClose={onClose} title="Pasillos de la tienda">
      <div className="flex flex-col gap-4">
        <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <div>
          <p className="mb-1.5 text-sm font-bold text-muted">Cadena</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cadena">
            {([...CHAINS, null] as Array<Chain | null>).map((c) => (
              <button key={c ?? "otra"} type="button" role="radio" aria-checked={chain === c} onClick={() => setChain(c)}
                className={cn("min-h-10 rounded-full px-4 text-sm font-bold transition", chain === c ? "bg-primary text-on-primary" : "bg-surface-2 text-muted")}>
                {c ? CHAIN_NAMES[c] : "Otra"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm font-bold text-muted">Orden de los pasillos</p>
          <p className="mb-2 text-sm text-muted">Arrastra según vayas recorriendo la tienda; en el modo tienda saldrán en este orden.</p>
          <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
            {order.map((id) => <AisleRow key={id} id={id} category={byId.get(id)} />)}
          </Reorder.Group>
        </div>
        <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>Guardar</Button>
        {confirmDelete
          ? <Button onClick={() => remove.mutate()} disabled={remove.isPending}>Sí, eliminar «{store?.name}»</Button>
          : <Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash size={20} /> Eliminar tienda</Button>}
      </div>
    </Sheet>
  );
}

function StoresCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const stores = useStores();
  const cats = useCategories();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Store | null>(null);
  const create = useMutation({
    mutationFn: () => api.createStore({ name: name.trim() }),
    onSuccess: ({ store }) => { setName(""); qc.invalidateQueries({ queryKey: ["stores"] }); setEditing(store); },
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });

  return (
    <Card title="Tiendas y pasillos">
      <p className="mb-4 text-sm text-muted">Cada supermercado tiene los pasillos en un orden distinto. Guárdalo y el modo tienda te llevará por la tienda sin volver atrás.</p>
      {(stores?.length ?? 0) > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {stores!.map((s) => (
            <li key={s.id}>
              <button onClick={() => setEditing(s)} className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-surface-2 px-4 text-left font-bold transition active:scale-[0.98]">
                <Storefront size={22} weight="duotone" className="text-primary" aria-hidden />
                <span className="flex-1">{s.name}</span>
                {s.chain && <span className="text-sm font-normal text-muted">{CHAIN_NAMES[s.chain]}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <Field label="Nueva tienda" placeholder="Mercadona, Carrefour…" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <Button type="submit" variant="soft" disabled={!name.trim() || create.isPending}><Plus size={18} weight="bold" aria-hidden /> Añadir</Button>
      </form>
      <StoreSheet store={editing} categories={cats.data?.categories ?? []} onClose={() => setEditing(null)} />
    </Card>
  );
}

function DataCard() {
  const toast = useToast();
  const install = useInstallPrompt();
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (format: "json" | "csv") => {
    setBusy(format);
    try { await downloadExport(format); }
    catch (e) { toast({ message: (e as Error).message, tone: "error" }); }
    finally { setBusy(null); }
  };
  return (
    <Card title="Tus datos">
      <p className="mb-4 text-sm text-muted">Llévate lo que hay en la app cuando quieras: listas, historial y miembros del hogar.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="soft" className="flex-1" onClick={() => download("json")} disabled={busy !== null}><DownloadSimple size={20} aria-hidden /> Todo (JSON)</Button>
        <Button variant="soft" className="flex-1" onClick={() => download("csv")} disabled={busy !== null}><DownloadSimple size={20} aria-hidden /> Listas (CSV)</Button>
      </div>
      {install.canInstall && (
        <Button className="mt-3 w-full" onClick={() => void install.install()}><DeviceMobile size={20} aria-hidden /> Instalar la app en este dispositivo</Button>
      )}
    </Card>
  );
}

const THEMES: Array<{ key: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { key: "system", label: "Sistema", Icon: SunHorizon },
  { key: "light", label: "Claro", Icon: Sun },
  { key: "dark", label: "Oscuro", Icon: MoonStars },
];

export function SettingsPage() {
  const { signOut } = useAuth();
  const [theme, setTheme] = useTheme();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 60_000 });

  return (
    <div className="mx-auto max-w-2xl px-5 pb-10 pt-8 md:px-10">
      <h1 className="mb-7 font-display text-4xl font-semibold">Ajustes</h1>
      <ProfileCard />
      <HouseholdCard />
      <StoresCard />
      <NotificationsCard />
      <SecurityCard />
      <AndroidCard />
      <DataCard />
      <Card title="Apariencia">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tema">
          {THEMES.map(({ key, label, Icon }) => (
            <button key={key} role="radio" aria-checked={theme === key} onClick={() => setTheme(key)}
              className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl text-sm font-bold transition", theme === key ? "bg-primary text-on-primary" : "bg-surface-2 text-muted")}>
              <Icon size={24} weight="duotone" />{label}
            </button>
          ))}
        </div>
      </Card>
      <Button variant="soft" className="w-full" onClick={() => signOut()}><SignOut size={20} /> Cerrar sesión</Button>
      <p className="mt-6 text-center text-sm text-muted">Compra en Familia{health.data ? ` · servidor v${health.data.version}` : ""}</p>
    </div>
  );
}
