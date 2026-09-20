import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowsClockwise, CloudSlash } from "@phosphor-icons/react";
import { useAuth } from "../lib/auth";
import { outbox, useOutbox } from "../lib/outbox";
import { useToast } from "./toast";

/** Conecta la cola de cambios pendientes con la sesión actual. */
export function SyncAgent() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (!user) return;
    void outbox.attach(qc, user.id, (n) =>
      toast({ message: n === 1 ? "Un cambio no se pudo aplicar (el producto ya no existía)" : `${n} cambios no se pudieron aplicar`, tone: "error" }));
    return () => outbox.detach();
  }, [user?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Aviso de conexión y de cambios por enviar. */
export function SyncBanner() {
  const { ops, syncing, offline } = useOutbox();
  const n = ops.length;
  const show = offline || n > 0;
  const plural = n === 1 ? "cambio" : "cambios";

  const text = offline
    ? n > 0 ? `Sin conexión · ${n} ${plural} por enviar` : "Sin conexión · puedes seguir usando tus listas"
    : syncing ? `Enviando ${n} ${plural}…` : `${n} ${plural} por enviar`;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <button
            role="status" onClick={() => void outbox.flush()} disabled={!n}
            className="flex w-full items-center justify-center gap-2 bg-mustard/25 px-4 py-2 text-sm font-bold text-ink"
          >
            {offline ? <CloudSlash size={18} weight="bold" aria-hidden /> : <ArrowsClockwise size={18} weight="bold" className={syncing ? "animate-spin" : ""} aria-hidden />}
            {text}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
