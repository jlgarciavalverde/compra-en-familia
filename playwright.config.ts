import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, locale: "es-ES", trace: "retain-on-failure" },
  // Servidor "de producción" con datos temporales: primero `pnpm build`.
  webServer: {
    command: `rm -rf e2e/.data && mkdir -p e2e/.data/downloads && printf 'PKapk-de-prueba' > e2e/.data/downloads/compra-en-familia.apk && printf '{"version":"1.0.0","size":1126129}' > e2e/.data/downloads/version.json && DATA_DIR=e2e/.data SETUP_CODE=e2e-setup AUTH_RATE_LIMIT=1000 PORT=${PORT} WEB_DIR=apps/web/dist LOG_LEVEL=warn node --disable-warning=ExperimentalWarning apps/api/dist/server.js`,
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
