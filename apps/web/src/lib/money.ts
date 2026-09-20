/** "2,99" o "2.99" → 2.99 (máximo dos decimales). null si no es un importe válido. */
export function parseEuro(input: string): number | null {
  const t = input.trim().replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : null;
}

/** 2.5 → "2,5" para mostrarlo en un campo de texto. */
export const euroField = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

/** "hoy", "ayer", "hace 3 días", "hace 2 semanas", "hace 4 meses". */
export function ago(ms: number, now = Date.now()): string {
  const days = Math.floor((now - ms) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 14) return `hace ${days} días`;
  if (days < 60) return `hace ${Math.floor(days / 7)} semanas`;
  return `hace ${Math.floor(days / 30)} meses`;
}
