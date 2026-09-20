import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { get, run, type DB } from "./db";
import { HttpError, toUser, type AuthUser } from "./http";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const SESSION_TTL_MS = 90 * 24 * 3600 * 1000;
const TOUCH_EVERY_MS = 24 * 3600 * 1000;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Sin usuario se compara contra un hash falso para no revelar por tiempo si el email existe.
  const [, saltB64, keyB64] = (stored ?? `scrypt$${"A".repeat(22)}==$${"A".repeat(86)}==`).split("$");
  const expected = Buffer.from(keyB64 ?? "", "base64");
  const actual = await scryptAsync(pw, Buffer.from(saltB64 ?? "", "base64"), expected.length || 64);
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const safeEqual = (a: string, b: string) => {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(db: DB, userId: string, userAgent?: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  run(db, "INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, user_agent) VALUES (?,?,?,?,?)",
    hashToken(token), userId, now, now, userAgent?.slice(0, 200) ?? null);
  return token;
}

export function deleteSession(db: DB, token: string) {
  run(db, "DELETE FROM sessions WHERE token_hash = ?", hashToken(token));
}

export function authenticateToken(db: DB, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const h = hashToken(token);
  const row = get(db,
    `SELECT u.*, s.last_used_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.removed_at IS NULL`, h);
  if (!row) return null;
  const now = Date.now();
  if (now - row.last_used_at > SESSION_TTL_MS) {
    run(db, "DELETE FROM sessions WHERE token_hash = ?", h);
    return null;
  }
  if (now - row.last_used_at > TOUCH_EVERY_MS) run(db, "UPDATE sessions SET last_used_at = ? WHERE token_hash = ?", now, h);
  return { ...toUser(row), householdId: row.household_id };
}

export function bearerToken(header: string | undefined): string | undefined {
  const m = header?.match(/^Bearer (.+)$/i);
  return m?.[1];
}

export function requireUser(db: DB, header: string | undefined): AuthUser {
  const user = authenticateToken(db, bearerToken(header));
  if (!user) throw new HttpError(401, "Sesión no válida");
  return user;
}
