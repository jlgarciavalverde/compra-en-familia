import { backupDb } from "./backup";
import { buildApp } from "./app";

const DATA_DIR = process.env.DATA_DIR ?? "data";

const app = await buildApp({
  dbPath: `${DATA_DIR}/compra.db`,
  version: process.env.APP_VERSION ?? "0.0.0",
  setupCode: process.env.SETUP_CODE || undefined,
  webDir: process.env.WEB_DIR ?? "web",
  downloadsDir: `${DATA_DIR}/downloads`,
  allowedOrigins: (process.env.ALLOWED_ORIGINS
    ?? (process.env.NODE_ENV === "production"
      ? "https://compra.redgarverde.com"
      : "https://compra.redgarverde.com,https://localhost,http://localhost:5173"))
    .split(",").map((s) => s.trim()).filter(Boolean),
  publicUrl: process.env.PUBLIC_URL,
  authRateLimit: process.env.AUTH_RATE_LIMIT ? Number(process.env.AUTH_RATE_LIMIT) : undefined,
  logLevel: process.env.LOG_LEVEL,
});

// Copia diaria de la base de datos (se refresca cada 6 h; queda una por día, 14 días).
const runBackup = () => {
  try { app.log.info({ file: backupDb(app.db, `${DATA_DIR}/backups`) }, "backup ok"); }
  catch (err) { app.log.error(err, "backup falló"); }
};
setTimeout(runBackup, 30_000).unref();
setInterval(runBackup, 6 * 3600 * 1000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => app.close().then(() => process.exit(0)));
}

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
