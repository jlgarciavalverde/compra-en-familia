import { describe, expect, it } from "vitest";
import { ago, euroField, parseEuro } from "./money";

describe("parseEuro", () => {
  it("acepta coma o punto y hasta dos decimales", () => {
    expect(parseEuro("2,99")).toBe(2.99);
    expect(parseEuro(" 2.5 ")).toBe(2.5);
    expect(parseEuro("12")).toBe(12);
    expect(parseEuro("0,5")).toBe(0.5);
  });
  it("rechaza lo que no es un importe", () => {
    for (const bad of ["", "abc", "-1", "1,234", "1,2,3", "2 €"]) expect(parseEuro(bad)).toBeNull();
  });
  it("euroField muestra con coma", () => {
    expect(euroField(2.5)).toBe("2,5");
    expect(euroField(null)).toBe("");
  });
});

describe("ago", () => {
  const now = new Date("2026-09-20T12:00:00").getTime();
  const days = (n: number) => now - n * 86_400_000;
  it("describe cuánto hace", () => {
    expect(ago(days(0), now)).toBe("hoy");
    expect(ago(days(1), now)).toBe("ayer");
    expect(ago(days(5), now)).toBe("hace 5 días");
    expect(ago(days(21), now)).toBe("hace 3 semanas");
    expect(ago(days(120), now)).toBe("hace 4 meses");
  });
});
