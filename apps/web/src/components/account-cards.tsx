import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AndroidLogo, Bell, BellSlash, DownloadSimple, Devices, ShieldCheck } from "@phosphor-icons/react";
import { API_URL, api, type PushPrefs } from "../lib/api";
import { cn } from "../lib/cn";
import { ago } from "../lib/money";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../lib/push";
import { Button, Field } from "./ui";
import { useToast } from "./toast";

export function Card({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-card bg-surface p-5 shadow-card">
      <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-semibold">{icon}{title}</h2>
      {children}
    </section>
  );
}

// ---------- Seguridad: contraseña y dispositivos ----------
export function SecurityCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions, networkMode: "always", retry: false });
  const [f, setF] = useState({ current: "", next: "", repeat: "" });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const change = useMutation({
    mutationFn: () => api.changePassword({ current: f.current, next: f.next }),
    onSuccess: () => {
      setF({ current: "", next: "", repeat: "" });
      setError("");
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast({ message: "Contraseña cambiada. Se ha cerrado la sesión en tus otros dispositivos." });
    },
    onError: (e) => setError(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });

  const submit = () => {
    if (f.next.length < 8) return setError("La contraseña nueva necesita al menos 8 caracteres");
    if (f.next !== f.repeat) return setError("Las dos contraseñas nuevas no coinciden");
    setError("");
    change.mutate();
  };
  const others = (sessions.data?.sessions ?? []).filter((s) => !s.current);

  return (
    <Card title="Seguridad" icon={<ShieldCheck size={24} weight="duotone" className="text-primary" aria-hidden />}>
      <form className="mb-6 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label="Cambiar contraseña">
        <Field label="Contraseña actual" type="password" autoComplete="current-password" value={f.current} onChange={set("current")} />
        <Field label="Contraseña nueva" type="password" autoComplete="new-password" value={f.next} onChange={set("next")} />
        <Field label="Repite la contraseña nueva" type="password" autoComplete="new-password" value={f.repeat} onChange={set("repeat")} />
        {error && <p role="alert" className="text-sm font-bold text-primary">{error}</p>}
        <Button type="submit" variant="soft" disabled={!f.current || !f.next || change.isPending}>Cambiar contraseña</Button>
      </form>

      <h3 className="mb-2 flex items-center gap-2 font-bold"><Devices size={20} weight="duotone" aria-hidden /> Dispositivos con tu sesión abierta</h3>
      {sessions.isPending ? <p className="text-sm text-muted">Cargando…</p> : sessions.isError ? (
        <p className="text-sm text-muted">No se puede consultar sin conexión.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.data!.sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{s.device}{s.current && <span className="ml-2 rounded-full bg-sage/25 px-2 py-0.5 text-xs">Este dispositivo</span>}</p>
                <p className="text-sm text-muted">Última vez {ago(s.lastUsedAt)}</p>
              </div>
              {!s.current && (
                <Button variant="ghost" className="min-h-10 px-4 text-sm" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}
                  aria-label={`Cerrar la sesión de ${s.device}`}>Cerrar</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <Button variant="soft" className="mt-3 w-full" onClick={() => revoke.mutate("others")} disabled={revoke.isPending}>Cerrar la sesión en los demás dispositivos</Button>
      )}
    </Card>
  );
}

// ---------- Notificaciones ----------
const PREF_LABELS: Array<[keyof PushPrefs, string]> = [
  ["added", "Cuando alguien añade productos"],
  ["assigned", "Cuando me asignan algo"],
  ["shopping", "Cuando alguien empieza a comprar"],
  ["completed", "Cuando se completa una lista"],
];

export function NotificationsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const supported = pushSupported();
  const permission = supported ? Notification.permission : "denied";

  const sub = useQuery({ queryKey: ["push", "sub"], queryFn: async () => !!(await currentSubscription()), enabled: supported });
  const prefs = useQuery({ queryKey: ["push", "prefs"], queryFn: api.pushPrefs, networkMode: "always", retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["push"] }); };

  const toggle = useMutation({
    mutationFn: async () => {
      if (sub.data) { await disablePush(); return "off" as const; }
      return enablePush();
    },
    onSuccess: (r) => {
      refresh();
      if (r === "denied") toast({ message: "Has bloqueado las notificaciones. Actívalas en los ajustes del navegador.", tone: "error" });
      if (r === "ok") toast({ message: "Notificaciones activadas en este dispositivo" });
    },
    onError: (e) => toast({ message: (e as Error).message || "No se pudieron activar", tone: "error" }),
  });
  const setPref = useMutation({
    mutationFn: (b: Partial<PushPrefs>) => api.setPushPrefs(b),
    onSuccess: refresh,
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });
  const test = useMutation({
    mutationFn: api.pushTest,
    onSuccess: ({ sent }) => toast({ message: sent > 0 ? `Aviso enviado a ${sent} ${sent === 1 ? "dispositivo" : "dispositivos"}` : "No hay ningún dispositivo con notificaciones activadas" }),
    onError: (e) => toast({ message: e.message, tone: "error" }),
  });

  return (
    <Card title="Notificaciones" icon={<Bell size={24} weight="duotone" className="text-primary" aria-hidden />}>
      {!supported ? (
        <p className="mb-4 text-sm text-muted">Este navegador no permite notificaciones. En Android usa Chrome o la app de Compra en Familia; en iPhone hay que instalarla antes en la pantalla de inicio.</p>
      ) : permission === "denied" && !sub.data ? (
        <p className="mb-4 flex gap-2 rounded-2xl bg-mustard/20 p-3 text-sm"><BellSlash size={20} className="shrink-0" aria-hidden />Has bloqueado las notificaciones de esta web en este dispositivo. Para activarlas, entra en los ajustes del navegador (el candado junto a la dirección → Permisos).</p>
      ) : (
        <Button variant={sub.data ? "soft" : "primary"} className="mb-4 w-full" onClick={() => toggle.mutate()} disabled={toggle.isPending || sub.isPending}>
          {sub.data ? <><BellSlash size={20} aria-hidden /> Desactivar en este dispositivo</> : <><Bell size={20} aria-hidden /> Activar en este dispositivo</>}
        </Button>
      )}

      {/* Qué avisos quieres es cosa de tu cuenta: vale para todos tus dispositivos. */}
      {prefs.data && (
        <ul className="mb-4 flex flex-col gap-1" aria-label="Qué avisos quieres">
          {PREF_LABELS.map(([k, label]) => (
            <li key={k}>
              <button role="switch" aria-checked={prefs.data.prefs[k]} onClick={() => setPref.mutate({ [k]: !prefs.data.prefs[k] })}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 text-left transition hover:bg-surface-2">
                <span className="flex-1 font-bold">{label}</span>
                <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", prefs.data.prefs[k] ? "bg-sage" : "bg-line")} aria-hidden>
                  <span className={cn("absolute top-0.5 size-6 rounded-full bg-surface shadow transition-all", prefs.data.prefs[k] ? "left-[1.375rem]" : "left-0.5")} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported && <Button variant="ghost" className="w-full" onClick={() => test.mutate()} disabled={test.isPending || !sub.data}>Enviarme un aviso de prueba</Button>}
      {prefs.data && <p className="mt-2 text-center text-sm text-muted">{prefs.data.devices} {prefs.data.devices === 1 ? "dispositivo suscrito" : "dispositivos suscritos"} con tu cuenta</p>}
    </Card>
  );
}

// ---------- App de Android ----------
interface ApkInfo { version: string; size: number; builtAt?: string }

/** Descarga del .apk. Solo aparece si el servidor tiene uno publicado y si no estás ya dentro de la app. */
export function AndroidCard() {
  const info = useQuery({
    queryKey: ["apk"],
    queryFn: async (): Promise<ApkInfo | null> => {
      const res = await fetch(`${API_URL}/version.json`);
      return res.ok ? ((await res.json()) as ApkInfo) : null;
    },
    staleTime: 5 * 60_000, retry: false, networkMode: "always",
  });
  const inApp = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;
  if (!info.data || inApp) return null;

  const mb = (info.data.size / 1_048_576).toFixed(1).replace(".", ",");
  return (
    <Card title="App para Android" icon={<AndroidLogo size={24} weight="duotone" className="text-primary" aria-hidden />}>
      <p className="mb-4 text-sm text-muted">
        Se abre a pantalla completa como cualquier app, con su icono, y se actualiza sola con la web: no hay que volver a instalarla.
      </p>
      <a
        href={`${API_URL}/app.apk`} download
        className="mb-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 font-bold text-on-primary shadow-card transition active:scale-[0.97]"
      >
        <DownloadSimple size={20} aria-hidden /> Descargar la app (.apk) · {mb} MB
      </a>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Abre el archivo descargado (en la notificación de descarga o en la app «Archivos»).</li>
        <li>Si Android lo pide, permite <strong className="text-ink">instalar apps de esta fuente</strong> para Chrome y vuelve atrás.</li>
        <li>Pulsa <strong className="text-ink">Instalar</strong> y abre «Compra».</li>
      </ol>
      <p className="mt-3 text-xs text-muted">Versión {info.data.version}. Android avisa de que viene de fuera de la tienda: es normal, la app es la de tu familia.</p>
    </Card>
  );
}
