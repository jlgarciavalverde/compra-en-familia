/** Minúsculas, sin acentos y con espacios colapsados. Base de búsqueda y de comparación de nombres. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function stemWord(w: string): string {
  if (w.length <= 3) return w;
  // limones -> limon, mejillones -> mejillon
  if (/[nldzj]es$/.test(w) && w.length > 4) return w.slice(0, -2);
  // tomates -> tomate, manzanas -> manzana
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** Forma "singular" aproximada, para que "tomate" y "tomates" sean el mismo producto. */
export function stem(s: string): string {
  return normalize(s).split(" ").map(stemWord).join(" ");
}

export function capitalize(s: string): string {
  const t = s.trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

export const UNITS = ["ud", "kg", "g", "l", "ml", "pack"] as const;
export type Unit = (typeof UNITS)[number];

const UNIT_ALIASES: Record<string, Unit> = {
  ud: "ud", uds: "ud", u: "ud", unidad: "ud", unidades: "ud",
  kg: "kg", kilo: "kg", kilos: "kg",
  g: "g", gr: "g", grs: "g", gramos: "g",
  l: "l", lt: "l", litro: "l", litros: "l",
  ml: "ml",
  pack: "pack", packs: "pack",
};

export interface ParsedItem {
  name: string;
  qty: number;
  unit: Unit | null;
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const UNIT_RE = "kg|kilos?|gramos|grs?|g|litros?|lt|l|ml|uds?|unidades|unidad|packs?|u";
const toNum = (s: string) => Number(s.replace(",", "."));
const toUnit = (s: string | undefined): Unit | null => (s ? (UNIT_ALIASES[s.toLowerCase()] ?? null) : null);

/** "2 kg de tomates", "huevos x12", "leche 2", "arroz 500g" -> { name, qty, unit } */
export function parseItem(raw: string): ParsedItem | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  let m: RegExpMatchArray | null;

  // "12 huevos", "2 kg de tomates", "1,5 l leche"
  if ((m = text.match(new RegExp(`^(${NUM})\\s*(${UNIT_RE})?\\s+(?:de\\s+)?(.+)$`, "i")))) {
    return { name: capitalize(m[3]!), qty: toNum(m[1]!), unit: toUnit(m[2]) };
  }
  // "huevos x12"
  if ((m = text.match(new RegExp(`^(.+?)\\s*x\\s*(${NUM})$`, "i")))) {
    return { name: capitalize(m[1]!), qty: toNum(m[2]!), unit: null };
  }
  // "arroz 500g", "leche 2 l"
  if ((m = text.match(new RegExp(`^(.+?)\\s+(${NUM})\\s*(${UNIT_RE})$`, "i")))) {
    return { name: capitalize(m[1]!), qty: toNum(m[2]!), unit: toUnit(m[3]) };
  }
  // "leche 2"
  if ((m = text.match(new RegExp(`^(.+?)\\s+(${NUM})$`)))) {
    return { name: capitalize(m[1]!), qty: toNum(m[2]!), unit: null };
  }
  return { name: capitalize(text), qty: 1, unit: null };
}

/**
 * Separa productos por comas, punto y coma o saltos de línea. Una coma entre dos cifras es decimal
 * ("1,5 kg de tomates" es un solo producto), no un separador.
 */
export const ITEM_SEPARATOR = /[;\n]+|,(?!\d)|(?<!\d),/;

export function parseItemsText(text: string): ParsedItem[] {
  return text
    .split(ITEM_SEPARATOR)
    .map(parseItem)
    .filter((x): x is ParsedItem => x !== null && x.qty > 0 && x.name.length > 0);
}
