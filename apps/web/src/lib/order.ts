/**
 * Nueva posición para el producto que se acaba de arrastrar: a medio camino entre sus vecinos.
 * Devuelve null si su posición ya es correcta (no hace falta enviar nada).
 */
export function positionFor(order: Array<{ id: string; position: number }>, movedId: string): number | null {
  const i = order.findIndex((x) => x.id === movedId);
  if (i < 0) return null;
  const cur = order[i]!.position;
  const prev = order[i - 1]?.position;
  const next = order[i + 1]?.position;
  if (prev === undefined && next === undefined) return null;
  if ((prev === undefined || cur > prev) && (next === undefined || cur < next)) return null;
  if (prev === undefined) return next! - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}
