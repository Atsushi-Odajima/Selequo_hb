// Value normalization. Never invents values: if the unit is missing or belongs to a different
// dimension than the attribute, the result is `null` plus an issue for human review.

import { CATALOG_BY_KEY, type CatalogAttribute } from './attributes';
import { parsePrice, priceUnit } from './price';
import type { AttrType, NormalizedValue } from './types';
import { type Dimension, baseUnitOf, convert, dimensionOf, findQuantities, parseNumber, round, toHalfWidth } from './units';

export type NormalizeIssue = 'unit_missing' | 'unit_mismatch' | 'range_value' | 'unparseable' | 'multiple_values' | null;

export interface NormalizeResult {
  value: NormalizedValue | null;
  issue: NormalizeIssue;
  note?: string;
}

export interface AttrShape {
  key: string;
  type: AttrType;
  unit?: string | null;
  dim?: Dimension;
}

export function shapeFor(key: string, override?: Partial<AttrShape>): AttrShape {
  const cat: CatalogAttribute | undefined = CATALOG_BY_KEY.get(key);
  return {
    key,
    type: override?.type ?? cat?.type ?? 'text',
    unit: override?.unit ?? cat?.unit ?? null,
    dim: override?.dim ?? cat?.dim ?? (override?.unit ? dimensionOf(override.unit) ?? undefined : undefined),
  };
}

const TRUE_WORDS = ['yes', 'true', 'supported', 'available', 'included', '対応', 'あり', '有', '可', '○', '◯', '✓', '✔', 'サポート'];
const FALSE_WORDS = ['no', 'false', 'not supported', 'unsupported', 'none', 'n/a', '非対応', 'なし', '無', '不可', '×', '✕', '未対応'];

export function normalizeValue(shape: AttrShape, raw: string): NormalizeResult {
  const text = toHalfWidth(raw).trim();
  if (!text) return { value: null, issue: 'unparseable' };
  switch (shape.type) {
    case 'text':
      return { value: { kind: 'text', value: text.replace(/\s+/g, ' ') }, issue: null };
    case 'bool': {
      const t = text.toLowerCase();
      if (FALSE_WORDS.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + '（') || t.startsWith(w + '('))) return { value: { kind: 'bool', value: false }, issue: null };
      if (TRUE_WORDS.some((w) => t === w || t.startsWith(w))) return { value: { kind: 'bool', value: true }, issue: null };
      return { value: null, issue: 'unparseable' };
    }
    case 'price': {
      const p = parsePrice(text);
      if (!p) return { value: null, issue: 'unparseable' };
      return { value: { kind: 'number', value: p.amount, unit: priceUnit(p) }, issue: null };
    }
    case 'number': {
      const dim = shape.dim;
      if (dim === 'count') {
        const m = text.match(/([\d,]+(?:\.\d+)?)/);
        const n = m ? parseNumber(m[1]) : null;
        if (/無制限|unlimited/i.test(text)) return { value: { kind: 'text', value: '無制限' }, issue: null };
        return n === null ? { value: null, issue: 'unparseable' } : { value: { kind: 'number', value: n, unit: null }, issue: null };
      }
      const qs = findQuantities(text);
      if (qs.length === 0) {
        return parseNumber(text) !== null
          ? { value: null, issue: 'unit_missing', note: '単位がないため自動換算しません' }
          : { value: null, issue: 'unparseable' };
      }
      const same = dim ? qs.filter((q) => q.dim === dim) : qs;
      if (same.length === 0) {
        return { value: null, issue: 'unit_mismatch', note: `単位 ${qs[0].unit} は ${shape.key} の単位系と一致しません` };
      }
      // Ranges like "1.2〜1.4kg" or "1.2-1.4 kg" are not collapsed into a single value.
      if (/\d\s*(〜|~|～|–|-|to)\s*\d/.test(text) && !/最大|up to|max/i.test(text)) {
        return { value: null, issue: 'range_value', note: '範囲表記のため単一値に変換しません' };
      }
      const q = same[0];
      const target = shape.unit ?? (dim ? baseUnitOf(dim) : null) ?? q.unit;
      let v = q.value;
      try {
        v = convert(q.value, q.unit, target);
      } catch {
        return { value: null, issue: 'unit_mismatch' };
      }
      const distinct = new Set(same.map((x) => round(convert(x.value, x.unit, target), 3)));
      return {
        value: { kind: 'number', value: round(v, 4), unit: target },
        issue: distinct.size > 1 ? 'multiple_values' : null,
        note: distinct.size > 1 ? '複数の値が含まれています（最初の値を採用、要確認）' : undefined,
      };
    }
  }
}

/** Whether two normalized values agree (used for conflict detection). */
export function valuesEqual(a: NormalizedValue | null, b: NormalizedValue | null): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'number' && b.kind === 'number') {
    if ((a.unit ?? '') !== (b.unit ?? '')) return false;
    if (a.value === b.value) return true;
    const denom = Math.max(Math.abs(a.value), Math.abs(b.value));
    return denom > 0 && Math.abs(a.value - b.value) / denom <= 0.005;
  }
  if (a.kind === 'text' && b.kind === 'text') return canonicalText(a.value) === canonicalText(b.value) || sameTextSignature(a.value, b.value);
  if (a.kind === 'bool' && b.kind === 'bool') return a.value === b.value;
  return false;
}

const UNIT_WORDS = new Set(['core', 'cores', 'year', 'years', 'yr', 'yrs', 'month', 'months', 'hour', 'hours', 'day', 'days', 'gb', 'tb', 'inch', 'inches', 'up', 'to', 'approx', 'about', 'the', 'and', 'with']);

/**
 * Paraphrase-tolerant text equality ("16コア" vs "16 cores", "2年間" vs "2 years"): same number sequence
 * and same significant Latin words. Different numbers or model words (Home vs Pro) still differ.
 */
function sameTextSignature(a: string, b: string): boolean {
  const sig = (s: string) => {
    const t = toHalfWidth(s).toLowerCase();
    const nums = (t.match(/\d+(?:\.\d+)?/g) ?? []).join(',');
    const words = (t.match(/[a-z][a-z0-9]*/g) ?? []).filter((w) => !UNIT_WORDS.has(w)).sort().join(',');
    return { nums, words };
  };
  const x = sig(a);
  const y = sig(b);
  return x.nums !== '' && x.nums === y.nums && x.words === y.words;
}

function canonicalText(s: string) {
  return toHalfWidth(s).toLowerCase().replace(/[\s,、。.・]+/g, '');
}

export function formatValue(v: NormalizedValue | null): string {
  if (!v) return 'Unknown';
  if (v.kind === 'bool') return v.value ? 'あり' : 'なし';
  if (v.kind === 'text') return v.value;
  const unit = v.unit;
  if (unit && /^[A-Z]{3}/.test(unit)) {
    const [cur, ...rest] = unit.split('/');
    const sym = cur === 'JPY' ? '¥' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur + ' ';
    const suffix = rest.map((r) => ({ month: '/月', year: '/年', seat: '/席' })[r] ?? '/' + r).join('');
    return `${sym}${v.value.toLocaleString('en-US')}${suffix}`;
  }
  if (unit === 'inch') return `${v.value}"`;
  if (unit === '%') return `${v.value}%`;
  return unit ? `${v.value} ${unit}` : String(v.value);
}
