// Unit parsing & conversion. Conversions are explicit and dimension-checked:
// a value is only converted inside its own dimension (data size, mass, ...).

export type Dimension =
  | 'data'
  | 'mass'
  | 'duration'
  | 'length'
  | 'frequency'
  | 'power'
  | 'energy'
  | 'charge'
  | 'percent'
  | 'count'
  | 'currency'
  | 'resolution';

interface UnitDef {
  unit: string; // canonical symbol
  dim: Dimension;
  factor: number; // multiply to get base unit of the dimension
  aliases: string[];
}

// Base units: data=GB (binary: 1TB = 1024GB, per product spec), mass=kg, duration=h,
// length=inch, frequency=GHz, power=W, energy=Wh, charge=mAh.
const UNITS: UnitDef[] = [
  { unit: 'TB', dim: 'data', factor: 1024, aliases: ['tb', 'tib', 'テラバイト'] },
  { unit: 'GB', dim: 'data', factor: 1, aliases: ['gb', 'gib', 'ギガバイト', 'ギガ'] },
  { unit: 'MB', dim: 'data', factor: 1 / 1024, aliases: ['mb', 'mib', 'メガバイト'] },
  { unit: 'kg', dim: 'mass', factor: 1, aliases: ['kg', 'キロ', 'キログラム', 'kilograms', 'kilogram'] },
  { unit: 'g', dim: 'mass', factor: 0.001, aliases: ['g', 'グラム', 'grams', 'gram'] },
  { unit: 'lb', dim: 'mass', factor: 0.45359237, aliases: ['lb', 'lbs', 'pounds', 'pound'] },
  { unit: 'h', dim: 'duration', factor: 1, aliases: ['h', 'hr', 'hrs', 'hour', 'hours', '時間'] },
  { unit: 'min', dim: 'duration', factor: 1 / 60, aliases: ['min', 'mins', 'minutes', '分'] },
  { unit: 'inch', dim: 'length', factor: 1, aliases: ['inch', 'inches', 'in', '"', '″', 'インチ', '型'] },
  { unit: 'cm', dim: 'length', factor: 1 / 2.54, aliases: ['cm', 'センチ'] },
  { unit: 'mm', dim: 'length', factor: 1 / 25.4, aliases: ['mm', 'ミリ'] },
  { unit: 'GHz', dim: 'frequency', factor: 1, aliases: ['ghz'] },
  { unit: 'MHz', dim: 'frequency', factor: 0.001, aliases: ['mhz'] },
  { unit: 'Hz', dim: 'frequency', factor: 1e-9, aliases: ['hz'] },
  { unit: 'W', dim: 'power', factor: 1, aliases: ['w', 'watt', 'watts', 'ワット'] },
  { unit: 'Wh', dim: 'energy', factor: 1, aliases: ['wh'] },
  { unit: 'mAh', dim: 'charge', factor: 1, aliases: ['mah'] },
  { unit: '%', dim: 'percent', factor: 1, aliases: ['%', 'percent', 'パーセント'] },
];

const ALIAS_INDEX = new Map<string, UnitDef>();
for (const u of UNITS) for (const a of [u.unit.toLowerCase(), ...u.aliases]) ALIAS_INDEX.set(a.toLowerCase(), u);

export function lookupUnit(token: string): UnitDef | undefined {
  return ALIAS_INDEX.get(token.trim().toLowerCase());
}

export function dimensionOf(unit: string | null | undefined): Dimension | null {
  if (!unit) return null;
  return lookupUnit(unit)?.dim ?? null;
}

export function baseUnitOf(dim: Dimension): string | null {
  const map: Partial<Record<Dimension, string>> = {
    data: 'GB',
    mass: 'kg',
    duration: 'h',
    length: 'inch',
    frequency: 'GHz',
    power: 'W',
    energy: 'Wh',
    charge: 'mAh',
    percent: '%',
  };
  return map[dim] ?? null;
}

/** Convert value between units of the same dimension. Throws on dimension mismatch. */
export function convert(value: number, from: string, to: string): number {
  const f = lookupUnit(from);
  const t = lookupUnit(to);
  if (!f || !t) throw new Error(`unknown unit ${from} or ${to}`);
  if (f.dim !== t.dim) throw new Error(`dimension mismatch: ${f.dim} vs ${t.dim}`);
  return round((value * f.factor) / t.factor);
}

export function round(n: number, digits = 6): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

/** Parse a number allowing full-width digits and thousands separators. */
export function parseNumber(s: string): number | null {
  const t = toHalfWidth(s).replace(/[,，\s]/g, '');
  if (!/^[-+]?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ．，：％]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

export interface Quantity {
  value: number;
  unit: string; // canonical unit symbol as written (not converted)
  dim: Dimension;
  matched: string;
  index: number;
}

const QTY_RE =
  /([-+]?\d[\d,]*(?:\.\d+)?)\s*(TB|TiB|GB|GiB|MB|MiB|kg|g|lbs?|hours?|hrs?|h|時間|minutes?|mins?|分|inch(?:es)?|インチ|型|cm|mm|GHz|MHz|Hz|Wh|W|mAh|%|テラバイト|ギガバイト|ギガ|グラム|キロ(?:グラム)?|"|″)(?![a-zA-Z])/gi;

/** Extract all quantities with units from a string. */
export function findQuantities(input: string): Quantity[] {
  const s = toHalfWidth(input);
  const out: Quantity[] = [];
  for (const m of s.matchAll(QTY_RE)) {
    const n = parseNumber(m[1]);
    const def = lookupUnit(m[2]);
    if (n === null || !def) continue;
    out.push({ value: n, unit: def.unit, dim: def.dim, matched: m[0], index: m.index ?? 0 });
  }
  return out;
}

export function formatQuantity(value: number, unit: string | null): string {
  const v = Number.isInteger(value) ? value.toLocaleString('en-US') : round(value, 3).toLocaleString('en-US');
  if (!unit) return v;
  if (unit === 'inch') return `${v}"`;
  if (unit === '%') return `${v}%`;
  return `${v} ${unit}`;
}
