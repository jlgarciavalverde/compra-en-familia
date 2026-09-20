import { z } from "zod";
import { all, get, run } from "../db";
import { HttpError } from "../http";
import { requireUser } from "../auth";
import { getPrefs, getVapid, isAllowedPushEndpoint, newSubscriptionId, PREF_KEYS } from "../push";
import type { Register } from "./ctx";

const Subscribe = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});
const Unsubscribe = z.object({ endpoint: z.string().url().max(600) });
const PrefsPatch = z.object({
  added: z.boolean().optional(),
  assigned: z.boolean().optional(),
  shopping: z.boolean().optional(),
  completed: z.boolean().optional(),
});

export const registerPush: Register = (app, { db, notifier }) => {
  /** Clave pública con la que el navegador suscribe el dispositivo. */
  app.get("/api/push/key", async (req) => {
    requireUser(db, req.headers.authorization);
    return { publicKey: getVapid(db).publicKey };
  });

  app.post("/api/push/subscribe", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const b = Subscribe.parse(req.body);
    if (!isAllowedPushEndpoint(b.endpoint)) throw new HttpError(400, "Ese servicio de notificaciones no es válido");
    const existing = get(db, "SELECT id FROM push_subscriptions WHERE endpoint = ?", b.endpoint);
    if (existing) {
      // Mismo dispositivo con otra cuenta (o claves renovadas): la suscripción pasa a esta persona.
      run(db, "UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ? WHERE id = ?",
        user.id, b.keys.p256dh, b.keys.auth, req.headers["user-agent"]?.slice(0, 200) ?? null, existing.id);
    } else {
      run(db, "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?,?,?,?,?,?,?)",
        newSubscriptionId(), user.id, b.endpoint, b.keys.p256dh, b.keys.auth, req.headers["user-agent"]?.slice(0, 200) ?? null, Date.now());
    }
    reply.code(204);
  });

  app.post("/api/push/unsubscribe", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const b = Unsubscribe.parse(req.body);
    run(db, "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", b.endpoint, user.id);
    reply.code(204);
  });

  app.get("/api/push/prefs", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const devices = all(db, "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?", user.id)[0]!.n as number;
    return { prefs: getPrefs(db, user.id), devices };
  });

  app.patch("/api/push/prefs", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const b = PrefsPatch.parse(req.body);
    const next = { ...getPrefs(db, user.id), ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
    run(db,
      "INSERT OR REPLACE INTO notification_prefs (user_id, added, assigned, shopping, completed) VALUES (?,?,?,?,?)",
      user.id, ...PREF_KEYS.map((k) => (next[k] ? 1 : 0)));
    return { prefs: getPrefs(db, user.id) };
  });

  /** Envía un aviso de prueba a los dispositivos de quien lo pide. */
  app.post("/api/push/test", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const sent = await notifier.sendTo(user.id, { title: "🛒 Compra en Familia", body: "¡Las notificaciones funcionan!", url: "/", tag: "test" });
    return { sent };
  });
};
