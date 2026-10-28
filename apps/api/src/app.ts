import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import type { ClientMessage, Health } from "@compra/shared";
import { authenticateToken, bearerToken } from "./auth";
import { get, openDb, run, type DB } from "./db";
import { createWebPushSender, Notifier } from "./push";
import { HttpError, type AuthUser } from "./http";
import { Hub } from "./realtime";
import { registerAccount } from "./routes/account";
import { registerCatalog } from "./routes/catalog";
import type { AppConfig, Ctx } from "./routes/ctx";
import { registerExport } from "./routes/export";
import { registerInsights } from "./routes/insights";
import { registerLists } from "./routes/lists";
import { registerPrices } from "./routes/prices";
import { registerPush } from "./routes/push";
import { registerStores } from "./routes/stores";

export type { AppConfig } from "./routes/ctx";

export type App = FastifyInstance & { db: DB; notifier: Notifier };

export async function buildApp(cfg: AppConfig): Promise<App> {
  const db = openDb(cfg.dbPath);
  const hub = new Hub();
  const sender = cfg.pushSender ?? createWebPushSender(db, cfg.publicUrl ?? "https://compra.redgarverde.com");
  const notifier = new Notifier(db, sender, { debounceMs: cfg.pushDebounceMs });
  const ctx: Ctx = { db, hub, cfg, notifier };

  const app = Fastify({
    logger: cfg.logLevel === "silent" ? false : { level: cfg.logLevel ?? "info", redact: ["req.headers.authorization"] },
    trustProxy: true,
    // El healthcheck de Docker no debe llenar los logs.
    logController: new LogController({ disableRequestLogging: (req) => req.url === "/health" }),
    bodyLimit: 100_000,
  });

  // Política de contenido estricta: solo scripts propios (sin inline), sin frames y solo conexiones a esta misma app.
  const wsOrigins = cfg.allowedOrigins.map((o) => o.replace(/^http/, "ws"));
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // la librería de animaciones usa estilos en línea
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", ...wsOrigins],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null, // en http://localhost (pruebas) rompería las peticiones
      },
    },
  });
  await app.register(cors, {
    origin: cfg.allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  });
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "validation", message: err.issues[0]?.message ?? "Datos no válidos" });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: "http", message: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: "request", message: e.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal", message: "Algo ha fallado en el servidor" });
  });

  // Idempotencia: la cola offline reenvía cada cambio con `Idempotency-Key`. Si ya se aplicó, se responde
  // 200 sin repetirlo (evita duplicar cantidades si la respuesta original se perdió).
  const idemKey = (req: { method: string; headers: Record<string, unknown> }) => {
    const k = req.headers["idempotency-key"];
    return req.method !== "GET" && typeof k === "string" && k.length > 0 && k.length <= 64 ? k : null;
  };
  app.addHook("preHandler", async (req, reply) => {
    const key = idemKey(req);
    const user = key ? authenticateToken(db, bearerToken(req.headers.authorization)) : null;
    if (key && user && get(db, "SELECT 1 AS x FROM applied_mutations WHERE key = ? AND user_id = ?", key, user.id)) {
      return reply.code(200).send({ replayed: true });
    }
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const key = idemKey(req);
    if (key && reply.statusCode < 300 && !(payload && String(payload).includes('"replayed":true'))) {
      const user = authenticateToken(db, bearerToken(req.headers.authorization));
      if (user) run(db, "INSERT OR IGNORE INTO applied_mutations (key, user_id, created_at) VALUES (?,?,?)", key, user.id, Date.now());
    }
    return payload;
  });

  app.get("/health", async (): Promise<Health> => ({
    status: "ok",
    version: cfg.version,
    uptime: Math.round(process.uptime()),
  }));

  registerAccount(app, ctx);
  registerLists(app, ctx);
  registerCatalog(app, ctx);
  registerStores(app, ctx);
  registerPrices(app, ctx);
  registerPush(app, ctx);
  registerInsights(app, ctx);
  registerExport(app, ctx);

  // Canal en tiempo real. El primer mensaje debe ser {type:"auth", token}; después {type:"shopping", listId|null}.
  app.get("/ws", { websocket: true }, (socket) => {
    let user: AuthUser | null = null;
    const timer = setTimeout(() => { if (!user) socket.close(4401, "auth timeout"); }, 10_000);
    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        if (!user) {
          user = msg?.type === "auth" ? authenticateToken(db, msg.token) : null;
          if (!user) return socket.close(4401, "unauthorized");
          hub.add(user.householdId, user.id, socket);
          hub.send(socket, { type: "ready" });
          hub.send(socket, { type: "presence", shopping: hub.presence(user.householdId) });
          return;
        }
        if (msg.type === "shopping") {
          const ok = msg.listId === null ||
            (typeof msg.listId === "string" &&
              get(db, "SELECT 1 AS x FROM lists WHERE id = ? AND household_id = ? AND deleted_at IS NULL", msg.listId, user.householdId));
          if (ok) {
            const me = user;
            const before = hub.presence(me.householdId).some((p) => p.userId === me.id);
            hub.setShopping(user.householdId, user.id, msg.listId);
            if (!before && msg.listId) notifier.shoppingStarted({ householdId: user.householdId, actorId: user.id, listId: msg.listId });
          }
        }
      } catch {
        socket.close(4400, "bad message");
      }
    });
    socket.on("close", () => clearTimeout(timer));
  });
  run(db, "DELETE FROM applied_mutations WHERE created_at < ?", Date.now() - 30 * 24 * 3600 * 1000);
  run(db, "DELETE FROM sessions WHERE last_used_at < ?", Date.now() - 90 * 24 * 3600 * 1000);
  run(db, "DELETE FROM password_resets WHERE expires_at < ?", Date.now() - 7 * 24 * 3600 * 1000);
  const pinger = setInterval(() => hub.pingAll(), 30_000);
  pinger.unref();
  app.addHook("onClose", async () => {
    clearInterval(pinger);
    await notifier.flush(); // envía lo pendiente antes de cerrar la BD
    db.close();
  });

  // Descarga de la app de Android. Los archivos los deja el despliegue en la carpeta de datos (no van en la imagen).
  const apkFile = cfg.downloadsDir ? join(cfg.downloadsDir, "compra-en-familia.apk") : undefined;
  const versionFile = cfg.downloadsDir ? join(cfg.downloadsDir, "version.json") : undefined;
  app.get("/app.apk", async (_req, reply) => {
    if (!apkFile || !existsSync(apkFile)) return reply.code(404).send({ error: "not_found", message: "La app de Android aún no está disponible" });
    return reply
      .header("Content-Type", "application/vnd.android.package-archive")
      .header("Content-Disposition", 'attachment; filename="compra-en-familia.apk"')
      .header("Cache-Control", "no-cache")
      .send(createReadStream(apkFile));
  });
  /** Versión, tamaño y huella del APK publicado (la web lo usa para mostrar el botón de descarga). */
  app.get("/version.json", async (_req, reply) => {
    if (!versionFile || !existsSync(versionFile)) return reply.code(404).send({ error: "not_found", message: "Sin versión publicada" });
    return reply.header("Cache-Control", "no-cache").type("application/json").send(readFileSync(versionFile, "utf8"));
  });

  const webDir = cfg.webDir ? resolve(cfg.webDir) : undefined;
  if (webDir && existsSync(webDir)) {
    await app.register(fastifyStatic, {
      root: webDir,
      // Android exige servir /.well-known/assetlinks.json para verificar que la app es de este dominio.
      dotfiles: "allow",
      cacheControl: false,
      setHeaders(res, path) {
        res.header("Cache-Control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const isApi = req.url.startsWith("/api") || req.url.startsWith("/ws") || req.url.startsWith("/.well-known/") || req.url.endsWith(".apk");
      if (req.method === "GET" && !isApi) return reply.header("Cache-Control", "no-cache").sendFile("index.html");
      return reply.code(404).send({ error: "not_found", message: "No encontrado" });
    });
  }

  return Object.assign(app, { db, notifier }) as App;
}
