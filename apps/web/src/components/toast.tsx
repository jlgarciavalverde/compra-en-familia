import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "default" | "error";
}

const Ctx = createContext<(t: ToastOptions) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const counter = useRef(0);

  const show = useCallback((t: ToastOptions) => {
    clearTimeout(timer.current);
    setToast({ ...t, id: ++counter.current });
    timer.current = setTimeout(() => setToast(null), t.actionLabel ? 7000 : 4000);
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-8">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              role="status"
              initial={{ y: 24, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={`pointer-events-auto flex max-w-md items-center gap-4 rounded-full px-5 py-3 text-sm shadow-card ${
                toast.tone === "error" ? "bg-primary text-on-primary" : "bg-ink text-bg"
              }`}
            >
              <span>{toast.message}</span>
              {toast.actionLabel && (
                <button
                  className="font-bold underline underline-offset-4"
                  onClick={() => { toast.onAction?.(); setToast(null); }}
                >
                  {toast.actionLabel}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
