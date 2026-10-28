import { NavLink, Outlet, useLocation } from "react-router";
import { Basket, ClockCounterClockwise, GearSix, ListChecks, ShoppingCart } from "@phosphor-icons/react";
import { useAuth } from "../lib/auth";
import { useRealtime } from "../lib/realtime";
import { cn } from "../lib/cn";
import { Avatar } from "./ui";
import { SyncAgent, SyncBanner } from "./sync";

const NAV = [
  { to: "/", label: "Listas", Icon: ListChecks, end: true },
  { to: "/comprar", label: "Comprar", Icon: ShoppingCart, end: false },
  { to: "/historial", label: "Historial", Icon: ClockCounterClockwise, end: false },
  { to: "/ajustes", label: "Ajustes", Icon: GearSix, end: false },
];

export function Shell() {
  const { user, household } = useAuth();
  const { pathname } = useLocation();
  useRealtime(!!user);
  const inList = pathname.startsWith("/listas/") || pathname.startsWith("/comprar/");

  return (
    <div className="mx-auto flex min-h-full max-w-6xl">
      {/* Barra lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-2 border-r border-line p-5 md:flex">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-primary"><Basket size={26} weight="duotone" /></div>
          <div className="leading-tight">
            <p className="font-display text-lg font-semibold">Compra en Familia</p>
            <p className="text-sm text-muted">{household?.name}</p>
          </div>
        </div>
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            className={({ isActive }) => cn(
              "flex min-h-12 items-center gap-3 rounded-2xl px-4 font-bold transition",
              isActive ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-2",
            )}
          >
            {({ isActive }) => (<><Icon size={24} weight={isActive ? "fill" : "duotone"} />{label}</>)}
          </NavLink>
        ))}
        {user && (
          <div className="mt-auto flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
            <Avatar user={user} size={40} />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-bold">{user.name}</p>
              <p className="text-sm text-muted">{user.role === "admin" ? "Administrador" : "Miembro"}</p>
            </div>
          </div>
        )}
      </aside>

      <SyncAgent />
      <main className={cn("min-w-0 flex-1", !inList && "pb-24 md:pb-0")}>
        <SyncBanner />
        <Outlet />
      </main>

      {/* Barra inferior (móvil) */}
      {!inList && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Principal">
          <div className="mx-auto flex max-w-md">
            {NAV.map(({ to, label, Icon, end }) => (
              <NavLink
                key={to} to={to} end={end}
                className={({ isActive }) => cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-bold transition", isActive ? "text-primary" : "text-muted")}
              >
                {({ isActive }) => (<><Icon size={26} weight={isActive ? "fill" : "duotone"} />{label}</>)}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
