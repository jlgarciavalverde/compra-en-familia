import { randomBytes, randomUUID } from "node:crypto";
import { ChangePasswordInput, LoginInput, ProfileInput, RegisterInput, ResetInput, type SessionInfo } from "@compra/shared";
import { all, get, run, tx } from "../db";
import { HttpError, toUser } from "../http";
import { bearerToken, createSession, deleteSession, hashPassword, hashToken, requireUser, safeEqual, verifyPassword } from "../auth";
import { seedHousehold } from "../seed";
import type { Register } from "./ctx";

const AVATAR_COLORS = ["#C94A2F", "#6B8C5F", "#D9962B", "#5B7FA6", "#9A5FA0", "#3F8F8B", "#B5566B", "#7A6A4F"];
const AVATAR_EMOJIS = ["🍎", "🥑", "🍋", "🥕", "🍓", "🧀", "🥐", "🍉", "🌽", "🫐"];
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

const newInviteCode = () =>
  Array.from(randomBytes(8), (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");

export const registerAccount: Register = (app, { db, hub, cfg }) => {
  const authLimit = { config: { rateLimit: { max: cfg.authRateLimit ?? 10, timeWindow: "1 minute" } } };

  // ---------- Público ----------
  app.get("/api/setup-status", async () => ({
    needsSetup: (get(db, "SELECT COUNT(*) AS c FROM households")!.c as number) === 0,
  }));

  app.get<{ Params: { code: string } }>("/api/invites/:code", authLimit, async (req) => {
    const inv = get(db,
      `SELECT h.name FROM invites i JOIN households h ON h.id = i.household_id
       WHERE i.code = ? AND i.used_at IS NULL AND i.expires_at > ?`,
      req.params.code.toUpperCase(), Date.now());
    return { valid: !!inv, householdName: inv?.name ?? null };
  });

  app.post("/api/auth/register", authLimit, async (req, reply) => {
    const b = RegisterInput.parse(req.body);
    if (get(db, "SELECT 1 AS x FROM users WHERE email = ?", b.email)) throw new HttpError(409, "Ya existe una cuenta con ese email");
    const passwordHash = await hashPassword(b.password);

    const userId = tx(db, () => {
      const now = Date.now();
      let householdId: string;
      let role: "admin" | "member";
      let inviteCode: string | null = null;

      if (b.inviteCode) {
        const inv = get(db, "SELECT * FROM invites WHERE code = ? AND used_at IS NULL AND expires_at > ?", b.inviteCode, now);
        if (!inv) throw new HttpError(400, "La invitación no es válida o ha caducado");
        householdId = inv.household_id;
        role = "member";
        inviteCode = inv.code;
      } else {
        if ((get(db, "SELECT COUNT(*) AS c FROM households")!.c as number) > 0)
          throw new HttpError(403, "El registro está cerrado: necesitas una invitación");
        if (!cfg.setupCode || !safeEqual(b.setupCode ?? "", cfg.setupCode))
          throw new HttpError(403, "El código de configuración no es correcto");
        householdId = randomUUID();
        role = "admin";
        run(db, "INSERT INTO households (id, name, created_at) VALUES (?,?,?)", householdId, b.householdName ?? "Mi hogar", now);
        seedHousehold(db, householdId);
      }

      const members = get(db, "SELECT COUNT(*) AS c FROM users WHERE household_id = ?", householdId)!.c as number;
      const id = randomUUID();
      run(db,
        `INSERT INTO users (id, household_id, email, name, password_hash, role, avatar_color, avatar_emoji, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        id, householdId, b.email, b.name, passwordHash, role,
        AVATAR_COLORS[members % AVATAR_COLORS.length]!, AVATAR_EMOJIS[members % AVATAR_EMOJIS.length]!, now);
      if (inviteCode) run(db, "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?", id, now, inviteCode);
      return id;
    });

    const user = toUser(get(db, "SELECT * FROM users WHERE id = ?", userId)!);
    const token = createSession(db, userId, req.headers["user-agent"]);
    reply.code(201);
    return { token, user };
  });

  app.post("/api/auth/login", authLimit, async (req) => {
    const b = LoginInput.parse(req.body);
    const row = get(db, "SELECT * FROM users WHERE email = ? AND removed_at IS NULL", b.email);
    const ok = await verifyPassword(b.password, row?.password_hash ?? null);
    if (!row || !ok) throw new HttpError(401, "Email o contraseña incorrectos");
    return { token: createSession(db, row.id, req.headers["user-agent"]), user: toUser(row) };
  });

  // ---------- Con sesión ----------
  app.post("/api/auth/logout", async (req, reply) => {
    requireUser(db, req.headers.authorization);
    deleteSession(db, bearerToken(req.headers.authorization)!);
    reply.code(204);
  });

  const household = (id: string) => ({
    ...get(db, "SELECT id, name FROM households WHERE id = ?", id)!,
    members: all(db, "SELECT * FROM users WHERE household_id = ? AND removed_at IS NULL ORDER BY created_at", id).map(toUser),
  });

  app.get("/api/me", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    return { user: toUser(get(db, "SELECT * FROM users WHERE id = ?", user.id)!), household: household(user.householdId) };
  });

  app.patch("/api/me", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const b = ProfileInput.parse(req.body);
    run(db,
      "UPDATE users SET name = COALESCE(?, name), avatar_color = COALESCE(?, avatar_color), avatar_emoji = COALESCE(?, avatar_emoji) WHERE id = ?",
      b.name ?? null, b.avatarColor ?? null, b.avatarEmoji ?? null, user.id);
    hub.broadcast(user.householdId, { type: "changed" });
    return { user: toUser(get(db, "SELECT * FROM users WHERE id = ?", user.id)!) };
  });

  app.post("/api/household/invites", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    if (user.role !== "admin") throw new HttpError(403, "Solo los administradores pueden invitar");
    const code = newInviteCode();
    const now = Date.now();
    run(db, "INSERT INTO invites (code, household_id, created_by, created_at, expires_at) VALUES (?,?,?,?,?)",
      code, user.householdId, user.id, now, now + INVITE_TTL_MS);
    reply.code(201);
    return { code, expiresAt: now + INVITE_TTL_MS };
  });

  /** Quitar a alguien del hogar (solo administradores). Conserva su historial pero ya no puede entrar. */
  app.delete<{ Params: { id: string } }>("/api/household/members/:id", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    if (user.role !== "admin") throw new HttpError(403, "Solo los administradores pueden quitar miembros");
    if (req.params.id === user.id) throw new HttpError(400, "No puedes quitarte a ti mismo");
    const target = get(db, "SELECT * FROM users WHERE id = ? AND household_id = ? AND removed_at IS NULL", req.params.id, user.householdId);
    if (!target) throw new HttpError(404, "Esa persona no está en el hogar");
    tx(db, () => {
      const now = Date.now();
      // El email queda libre y la contraseña inservible; el nombre se conserva para el historial.
      run(db, "UPDATE users SET removed_at = ?, email = ?, password_hash = '!' WHERE id = ?", now, `${target.id}@removed.invalid`, target.id);
      run(db, "DELETE FROM sessions WHERE user_id = ?", target.id);
      run(db, "DELETE FROM push_subscriptions WHERE user_id = ?", target.id);
      run(db, "UPDATE list_items SET assignee_id = NULL, updated_at = ? WHERE assignee_id = ?", now, target.id);
    });
    hub.kick(target.id);
    hub.setShopping(user.householdId, target.id, null);
    hub.broadcast(user.householdId, { type: "changed" });
    reply.code(204);
  });
  // ---------- Contraseña y sesiones ----------
  /** "Chrome en Android", "Firefox en Windows"… a partir del user-agent. */
  const describeDevice = (ua: string | null): string => {
    if (!ua) return "Dispositivo desconocido";
    const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
      : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
    const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? `${browser} en ${os}` : browser;
  };

  app.post("/api/me/password", authLimit, async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const b = ChangePasswordInput.parse(req.body);
    const row = get(db, "SELECT password_hash FROM users WHERE id = ?", user.id)!;
    if (!(await verifyPassword(b.current, row.password_hash))) throw new HttpError(400, "La contraseña actual no es correcta");
    const hash = await hashPassword(b.next);
    const keep = hashToken(bearerToken(req.headers.authorization)!);
    tx(db, () => {
      run(db, "UPDATE users SET password_hash = ? WHERE id = ?", hash, user.id);
      // Cambiar la contraseña cierra la sesión en el resto de dispositivos.
      run(db, "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", user.id, keep);
    });
    reply.code(204);
  });

  app.get("/api/me/sessions", async (req) => {
    const user = requireUser(db, req.headers.authorization);
    const current = hashToken(bearerToken(req.headers.authorization)!);
    const rows = all(db, "SELECT token_hash, user_agent, created_at, last_used_at FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC", user.id);
    const sessions: SessionInfo[] = rows.map((r) => ({
      id: (r.token_hash as string).slice(0, 16), current: r.token_hash === current,
      device: describeDevice(r.user_agent), createdAt: r.created_at, lastUsedAt: r.last_used_at,
    }));
    return { sessions };
  });

  /** Cierra una sesión concreta, o todas las demás con `others`. */
  app.delete<{ Params: { id: string } }>("/api/me/sessions/:id", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    const current = hashToken(bearerToken(req.headers.authorization)!);
    if (req.params.id === "others") run(db, "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", user.id, current);
    else run(db, "DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?", user.id, req.params.id);
    reply.code(204);
  });

  // ---------- Recuperar el acceso (sin correo: lo genera un administrador) ----------
  const RESET_TTL_MS = 24 * 3600 * 1000;

  app.post<{ Params: { id: string } }>("/api/household/members/:id/reset", async (req, reply) => {
    const user = requireUser(db, req.headers.authorization);
    if (user.role !== "admin") throw new HttpError(403, "Solo los administradores pueden restablecer accesos");
    const target = get(db, "SELECT * FROM users WHERE id = ? AND household_id = ? AND removed_at IS NULL", req.params.id, user.householdId);
    if (!target) throw new HttpError(404, "Esa persona no está en el hogar");
    if (target.id === user.id) throw new HttpError(400, "Para cambiar tu contraseña usa Ajustes → Seguridad");
    const code = newInviteCode();
    const now = Date.now();
    tx(db, () => {
      run(db, "DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL", target.id);
      run(db, "INSERT INTO password_resets (code, user_id, created_by, created_at, expires_at) VALUES (?,?,?,?,?)", code, target.id, user.id, now, now + RESET_TTL_MS);
    });
    reply.code(201);
    return { code, name: target.name, expiresAt: now + RESET_TTL_MS };
  });

  app.get<{ Params: { code: string } }>("/api/reset/:code", authLimit, async (req) => {
    const row = get(db,
      `SELECT u.name FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.code = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.removed_at IS NULL`, req.params.code.toUpperCase(), Date.now());
    return { valid: !!row, name: row?.name ?? null };
  });

  app.post("/api/auth/reset", authLimit, async (req) => {
    const b = ResetInput.parse(req.body);
    const now = Date.now();
    const r = get(db,
      `SELECT r.code, u.* FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.code = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.removed_at IS NULL`, b.code, now);
    if (!r) throw new HttpError(400, "El enlace no es válido o ha caducado");
    const hash = await hashPassword(b.password);
    tx(db, () => {
      run(db, "UPDATE users SET password_hash = ? WHERE id = ?", hash, r.id);
      run(db, "UPDATE password_resets SET used_at = ? WHERE code = ?", now, r.code);
      run(db, "DELETE FROM sessions WHERE user_id = ?", r.id);
    });
    return { token: createSession(db, r.id, req.headers["user-agent"]), user: toUser(r) };
  });
};
