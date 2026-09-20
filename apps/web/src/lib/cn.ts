export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export function formatQty(qty: number, unit: string | null): string | null {
  const n = Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(2))).replace(".", ",");
  if (unit && unit !== "ud") return `${n} ${unit}`;
  return qty === 1 && !unit ? null : `×${n}`;
}
