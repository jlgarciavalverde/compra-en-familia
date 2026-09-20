import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db";

const NAME = /^compra-\d{4}-\d{2}-\d{2}\.db$/;

/** Copia consistente de la base de datos (VACUUM INTO) en `dir`, una por día, conservando las últimas `keep`. */
export function backupDb(db: DB, dir: string, keep = 14, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `compra-${now.toISOString().slice(0, 10)}.db`);
  if (existsSync(target)) rmSync(target);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const files = readdirSync(dir).filter((f) => NAME.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, old));
  return target;
}
