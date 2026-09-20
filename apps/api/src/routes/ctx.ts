import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import type { Notifier, PushSender } from "../push";
import type { Hub } from "../realtime";

export interface AppConfig {
  dbPath: string;
  version: string;
  setupCode?: string;
  webDir?: string;
  allowedOrigins: string[];
  /** Intentos por minuto y por IP en registro/inicio de sesión (10 por defecto). */
  authRateLimit?: number;
  /** Dirección pública de la app (identifica al servidor ante los servicios de push). */
  publicUrl?: string;
  /** Para pruebas: sustituye el envío real de notificaciones. */
  pushSender?: PushSender;
  /** Espera para agrupar avisos seguidos (30 s por defecto). */
  pushDebounceMs?: number;
  logLevel?: string;
}

export interface Ctx {
  db: DB;
  hub: Hub;
  notifier: Notifier;
  cfg: AppConfig;
}

export type Register = (app: FastifyInstance, ctx: Ctx) => void;
