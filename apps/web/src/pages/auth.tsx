import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Basket } from "@phosphor-icons/react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Field, Spinner } from "../components/ui";

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="grid size-16 place-items-center rounded-[22px] bg-surface-2 text-primary shadow-card"><Basket size={36} weight="duotone" /></div>
        <p className="font-display text-lg text-muted">Compra en Familia</p>
        <h1 className="font-display text-4xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="text-muted">{subtitle}</p>}
      </div>
      <div className="rounded-card bg-surface p-6 shadow-card">{children}</div>
    </main>
  );
}

function useSubmit(fn: () => Promise<{ token: string }>) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { token } = await fn();
      await signIn(token);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Algo ha fallado");
    } finally {
      setBusy(false);
    }
  };
  return { submit, error, busy };
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, error, busy } = useSubmit(() => api.login({ email, password }));
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Contraseña" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="text-sm font-bold text-primary">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
      </form>
      <div className="my-5 h-px bg-line" />
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => { e.preventDefault(); if (code.trim()) navigate(`/unirse/${code.trim().toUpperCase()}`); }}
      >
        <Field label="¿Tienes un código de invitación?" className="flex-1" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD2345" autoCapitalize="characters" />
        <Button variant="soft" type="submit">Unirme</Button>
      </form>
    </>
  );
}

function RegisterForm({ mode, inviteCode }: { mode: "setup" | "join"; inviteCode?: string }) {
  const [f, setF] = useState({ name: "", email: "", password: "", householdName: "", setupCode: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const { submit, error, busy } = useSubmit(() =>
    api.register({
      name: f.name, email: f.email, password: f.password,
      ...(mode === "join" ? { inviteCode } : { householdName: f.householdName || undefined, setupCode: f.setupCode }),
    }),
  );
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Tu nombre" autoComplete="name" required value={f.name} onChange={set("name")} />
      <Field label="Email" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
      <Field label="Contraseña" type="password" autoComplete="new-password" minLength={8} required value={f.password} onChange={set("password")} />
      {mode === "setup" && (
        <>
          <Field label="Nombre del hogar" placeholder="Casa García" value={f.householdName} onChange={set("householdName")} />
          <Field label="Código de configuración" required value={f.setupCode} onChange={set("setupCode")} autoComplete="off" />
        </>
      )}
      {error && <p role="alert" className="text-sm font-bold text-primary">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Creando…" : mode === "setup" ? "Crear mi hogar" : "Unirme al hogar"}</Button>
    </form>
  );
}

export function LoginPage() {
  const { user, loading } = useAuth();
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setupStatus });
  if (loading || setup.isPending) return <Spinner />;
  if (user) return <Navigate to="/" replace />;

  return setup.data?.needsSetup ? (
    <AuthLayout title="Crea tu hogar" subtitle="Eres la primera persona: serás la administradora y podrás invitar al resto.">
      <RegisterForm mode="setup" />
    </AuthLayout>
  ) : (
    <AuthLayout title="Bienvenido de nuevo" subtitle="La lista de la compra de casa, siempre al día.">
      <LoginForm />
    </AuthLayout>
  );
}

export function ResetPage() {
  const { code = "" } = useParams();
  const { loading, signIn } = useAuth();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ["reset", code], queryFn: () => api.resetInfo(code), retry: false });
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (loading || info.isPending) return <Spinner />;

  if (!info.data?.valid) {
    return (
      <AuthLayout title="Enlace no válido" subtitle="El enlace ha caducado o ya se ha usado. Pide uno nuevo a quien administra el hogar.">
        <Link to="/entrar" className="block text-center font-bold text-primary">Volver a entrar</Link>
      </AuthLayout>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("La contraseña necesita al menos 8 caracteres");
    if (password !== repeat) return setError("Las dos contraseñas no coinciden");
    setError("");
    setBusy(true);
    try {
      const { token } = await api.resetPassword({ code, password });
      await signIn(token);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Algo ha fallado");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title={`Hola, ${info.data.name}`} subtitle="Elige una contraseña nueva para volver a entrar.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Contraseña nueva" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Repite la contraseña" type="password" autoComplete="new-password" minLength={8} required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        {error && <p role="alert" className="text-sm font-bold text-primary">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar y entrar"}</Button>
      </form>
    </AuthLayout>
  );
}

export function JoinPage() {
  const { code = "" } = useParams();
  const { user, loading } = useAuth();
  const invite = useQuery({ queryKey: ["invite", code], queryFn: () => api.invite(code), retry: false });
  if (loading || invite.isPending) return <Spinner />;
  if (user) return <Navigate to="/" replace />;

  if (!invite.data?.valid) {
    return (
      <AuthLayout title="Invitación no válida" subtitle="El código ha caducado o ya se ha usado. Pide uno nuevo a quien administra el hogar.">
        <Link to="/entrar" className="block text-center font-bold text-primary">Volver a entrar</Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={`Únete a ${invite.data.householdName}`} subtitle="Crea tu cuenta para compartir las listas de la compra.">
      <RegisterForm mode="join" inviteCode={code} />
    </AuthLayout>
  );
}
