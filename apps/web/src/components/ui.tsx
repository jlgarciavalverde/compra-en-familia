import { useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "@phosphor-icons/react";
import type { User } from "@compra/shared";
import { cn } from "../lib/cn";

// ---------- Botón ----------
type Variant = "primary" | "soft" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary shadow-card hover:brightness-105",
  soft: "bg-surface-2 text-ink hover:brightness-95",
  ghost: "text-muted hover:bg-surface-2",
  danger: "bg-surface-2 text-primary hover:brightness-95",
};

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 font-bold transition active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function IconButton({ label, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...p}
      aria-label={label}
      title={label}
      className={cn("grid size-12 place-items-center rounded-full text-ink transition hover:bg-surface-2 active:scale-95", className)}
    />
  );
}

// ---------- Campo de texto ----------
export function Field({ label, error, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold text-muted">{label}</label>
      <input
        id={id}
        {...p}
        className="min-h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink outline-none transition placeholder:text-muted/60 focus:border-primary focus:ring-4 focus:ring-primary/15"
      />
      {error && <p className="mt-1 text-sm text-primary">{error}</p>}
    </div>
  );
}

// ---------- Hoja inferior (diálogo en escritorio) ----------
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
          <motion.div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-bg p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-card md:max-w-md md:rounded-[28px]"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line md:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">{title}</h2>
              <IconButton label="Cerrar" onClick={onClose} className="-mr-2"><X size={22} /></IconButton>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------- Avatar ----------
export function Avatar({ user, size = 32, ring }: { user: Pick<User, "avatarColor" | "avatarEmoji" | "name">; size?: number; ring?: boolean }) {
  return (
    <span
      title={user.name}
      className={cn("inline-grid shrink-0 place-items-center rounded-full", ring && "ring-2 ring-bg")}
      style={{ width: size, height: size, background: `${user.avatarColor}33`, fontSize: size * 0.55 }}
    >
      <span aria-hidden>{user.avatarEmoji}</span>
      <span className="sr-only">{user.name}</span>
    </span>
  );
}

// ---------- Anillo de progreso ----------
export function ProgressRing({ value, size = 44 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(value * 100)}% completado`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={5} className="stroke-line" />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={5} strokeLinecap="round"
        className={value >= 1 ? "stroke-sage" : "stroke-primary"}
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c * (1 - value) }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

// ---------- Selector de emoji ----------
export const LIST_EMOJIS = ["🛒", "🥦", "🍎", "🥖", "🧀", "🍖", "🐟", "🥛", "🧴", "💊", "🎉", "🏠", "🐶", "🍕", "🎂", "🌮"];
export const PROFILE_EMOJIS = ["🍎", "🥑", "🍋", "🥕", "🍓", "🧀", "🥐", "🍉", "🌽", "🫐", "🍕", "🐱"];
export const PROFILE_COLORS = ["#C94A2F", "#6B8C5F", "#D9962B", "#5B7FA6", "#9A5FA0", "#3F8F8B", "#B5566B", "#7A6A4F"];

export function EmojiPicker({ value, onChange, options = LIST_EMOJIS }: { value: string; onChange: (e: string) => void; options?: string[] }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Emoji">
      {options.map((e) => (
        <button
          key={e} type="button" role="radio" aria-checked={value === e}
          onClick={() => onChange(e)}
          className={cn("grid size-12 place-items-center rounded-2xl text-2xl transition active:scale-90",
            value === e ? "bg-primary/10 ring-2 ring-primary" : "bg-surface-2")}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

// ---------- Estado vacío ----------
export function EmptyState({ emoji, title, text, children }: { emoji: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-14 text-center">
      <motion.div
        initial={{ scale: 0.6, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
        className="grid size-24 place-items-center rounded-[32px] bg-surface-2 text-5xl shadow-card"
        aria-hidden
      >
        {emoji}
      </motion.div>
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <p className="text-muted">{text}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="grid min-h-40 place-items-center" role="status" aria-label="Cargando">
      <div className="size-8 animate-spin rounded-full border-4 border-line border-t-primary" />
    </div>
  );
}
