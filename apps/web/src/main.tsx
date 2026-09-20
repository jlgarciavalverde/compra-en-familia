import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, useIsRestoring } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { asyncStorage, KEYS } from "./lib/store";
import { ToastProvider } from "./components/toast";
import { Spinner } from "./components/ui";
import "./lib/theme";
import "./styles.css";

const DAY = 24 * 3600_000;

const queryClient = new QueryClient({
  defaultOptions: {
    // La caché se guarda en el dispositivo y debe servir sin conexión, así que no se descarta al salir de una pantalla.
    // Ojo: un gcTime finito superior a ~24,8 días desborda setTimeout y borra la caché al instante.
    queries: { staleTime: 10_000, gcTime: Infinity, refetchOnWindowFocus: true, retry: 1 },
    // Las mutaciones se intentan siempre (fallan al instante sin red) en vez de quedarse en pausa sin avisar.
    mutations: { networkMode: "always" },
  },
});

const persister = createAsyncStoragePersister({ storage: asyncStorage, key: KEYS.queryCache, throttleTime: 1000 });
const PERSISTED = new Set(["me", "categories", "lists", "list", "catalog", "stores", "suggestions", "history", "prices"]);

/** Espera a recuperar la caché del dispositivo para no mostrar "sin datos" por un instante. */
function Restored({ children }: { children: ReactNode }) {
  return useIsRestoring() ? <Spinner /> : <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 30 * DAY,
        buster: "4",
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === "success" && PERSISTED.has(String(q.queryKey[0])) },
      }}
    >
      <Restored>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </Restored>
    </PersistQueryClientProvider>
  </StrictMode>,
);

// En el APK (Capacitor) la app va empaquetada: no hace falta service worker.
const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
if (!isNative) registerSW({ immediate: true });
