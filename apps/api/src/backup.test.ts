import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { backupDb } from "./backup";
import { all, openDb, run } from "./db";

const dir = mkdtempSync(join(tmpdir(), "compra-backup-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("backupDb", () => {
  it("genera una copia que se puede abrir y conserva solo las últimas N", () => {
    const db = openDb(join(dir, "origen.db"));
    run(db, "INSERT INTO households (id, name, created_at) VALUES ('h1', 'Casa', 1)");

    for (let d = 1; d <= 5; d++) backupDb(db, join(dir, "b"), 3, new Date(`2026-09-0${d}T10:00:00Z`));
    expect(readdirSync(join(dir, "b")).sort()).toEqual(["compra-2026-09-03.db", "compra-2026-09-04.db", "compra-2026-09-05.db"]);

    const restored = openDb(join(dir, "b", "compra-2026-09-05.db"));
    expect(all(restored, "SELECT name FROM households")).toEqual([expect.objectContaining({ name: "Casa" })]);
    restored.close();
    db.close();
  });

  it("sobrescribe la copia del mismo día", () => {
    const db = openDb(join(dir, "otro.db"));
    const day = new Date("2026-10-01T08:00:00Z");
    backupDb(db, join(dir, "c"), 14, day);
    run(db, "INSERT INTO households (id, name, created_at) VALUES ('h2', 'Nueva', 2)");
    backupDb(db, join(dir, "c"), 14, day);
    const copy = openDb(join(dir, "c", "compra-2026-10-01.db"));
    expect(all(copy, "SELECT id FROM households")).toHaveLength(1);
    copy.close();
    db.close();
  });
});
