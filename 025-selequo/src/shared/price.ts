// Price parsing and comparability. Monthly and annual prices are never silently compared:
// a cost basis must be chosen explicitly and every conversion is reported in `steps`.

import type { BillingPeriod, PriceSnapshot, TaxMode } from './types';
import { parseNumber, toHalfWidth } from './units';

export interface ParsedPrice {
  amount: number;
  currency: string;
  billingPeriod: BillingPeriod;
  perSeat: boolean;
  tax: TaxMode;
  shippingIncluded: boolean | null;
}

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/(?:¥|￥|JPY)\s*([\d,]+(?:\.\d+)?)/i, 'JPY'],
  [/([\d,]+(?:\.\d+)?)\s*円/, 'JPY'],
  [/(?:US\$|\$|USD)\s*([\d,]+(?:\.\d+)?)/i, 'USD'],
  [/([\d,]+(?:\.\d+)?)\s*(?:USD|ドル)/i, 'USD'],
  [/(?:€|EUR)\s*([\d,]+(?:\.\d+)?)/i, 'EUR'],
  [/([\d,]+(?:\.\d+)?)\s*(?:€|EUR|ユーロ)/i, 'EUR'],
];

export function parsePrice(raw: string): ParsedPrice | null {
  const s = toHalfWidth(raw);
  let amount: number | null = null;
  let currency = '';
  for (const [re, cur] of CURRENCY_PATTERNS) {
    const m = s.match(re);
    if (m) {
      amount = parseNumber(m[1]);
      currency = cur;
      break;
    }
  }
  if (amount === null) return null;
  const lower = s.toLowerCase();
  let billingPeriod: BillingPeriod = 'one_time';
  if (/(\/\s*月|月額|毎月|per\s*month|\/\s*mo(nth)?\b|monthly|ヶ月ごと)/i.test(lower)) billingPeriod = 'monthly';
  else if (/(\/\s*年|年額|毎年|per\s*year|\/\s*yr|\/\s*year|annual|annually|yearly|年間)/i.test(lower)) billingPeriod = 'annual';
  const perSeat = /(\/\s*(user|seat|ユーザー|人|名|ID)|per\s*(user|seat)|ユーザーあたり|1ユーザー|1人あたり|1ID)/i.test(lower);
  let tax: TaxMode = 'unknown';
  if (/(税込|tax\s*incl|incl\.?\s*tax|including\s*tax|内税)/i.test(lower)) tax = 'included';
  else if (/(税別|税抜|tax\s*excl|excl\.?\s*tax|excluding\s*tax|\+\s*tax|外税|plus\s*tax)/i.test(lower)) tax = 'excluded';
  let shippingIncluded: boolean | null = null;
  if (/(送料無料|送料込|free\s*shipping|shipping\s*included)/i.test(lower)) shippingIncluded = true;
  else if (/(送料別|plus\s*shipping|shipping\s*extra)/i.test(lower)) shippingIncluded = false;
  return { amount, currency, billingPeriod, perSeat, tax, shippingIncluded };
}

export function priceUnit(p: { currency: string; billingPeriod: BillingPeriod; perSeat: boolean }): string {
  let u = p.currency;
  if (p.billingPeriod === 'monthly') u += '/month';
  if (p.billingPeriod === 'annual') u += '/year';
  if (p.perSeat) u += '/seat';
  return u;
}

export type CostBasis = 'as_listed' | 'annual_total' | 'monthly_equivalent';

export interface CostResult {
  comparable: boolean;
  value: number | null;
  currency: string;
  steps: string[]; // human-readable formula steps
  warnings: string[];
}

/**
 * Compute a comparable cost for a snapshot under an explicit basis.
 * - as_listed: only comparable with the same billing period (caller checks).
 * - annual_total: monthly×12 (stated), annual as-is, one_time as-is (stated as purchase price).
 * Per-seat prices are multiplied by `seats` (must be provided) — otherwise not comparable.
 * FX conversion requires fxRate on the snapshot; otherwise not comparable across currencies.
 */
export function computeCost(
  snap: Pick<PriceSnapshot, 'amount' | 'currency' | 'billingPeriod' | 'perSeat' | 'tax' | 'shipping' | 'fxRate' | 'fxBase' | 'fxSource' | 'fxAt' | 'contractMonths'>,
  opts: { basis: CostBasis; seats?: number | null; targetCurrency: string; includeShipping?: boolean },
): CostResult {
  const steps: string[] = [];
  const warnings: string[] = [];
  let v = snap.amount;
  steps.push(`${snap.amount.toLocaleString('en-US')} ${snap.currency} (${periodLabel(snap.billingPeriod)}${snap.perSeat ? '・1席あたり' : ''}${taxLabel(snap.tax)})`);
  if (snap.tax === 'unknown') warnings.push('税込/税別が不明');
  if (snap.perSeat) {
    if (!opts.seats || opts.seats <= 0) return { comparable: false, value: null, currency: opts.targetCurrency, steps, warnings: [...warnings, '席数が未設定のため比較不可'] };
    v = v * opts.seats;
    steps.push(`× ${opts.seats}席 = ${fmt(v)}`);
  }
  if (opts.basis === 'annual_total') {
    if (snap.billingPeriod === 'monthly') {
      v = v * 12;
      steps.push(`月額 × 12ヶ月 = ${fmt(v)}（年額換算）`);
    } else if (snap.billingPeriod === 'one_time') {
      steps.push('買い切り価格として扱う（年額換算しない）');
    } else if (snap.billingPeriod === 'unknown') {
      return { comparable: false, value: null, currency: opts.targetCurrency, steps, warnings: [...warnings, '課金周期が不明のため比較不可'] };
    }
  } else if (opts.basis === 'monthly_equivalent') {
    if (snap.billingPeriod === 'annual') {
      v = v / 12;
      steps.push(`年額 ÷ 12ヶ月 = ${fmt(v)}（月額換算）`);
    } else if (snap.billingPeriod !== 'monthly') {
      return { comparable: false, value: null, currency: opts.targetCurrency, steps, warnings: [...warnings, '月額換算できない課金形態'] };
    }
  }
  if (opts.includeShipping && snap.shipping != null) {
    v += snap.shipping;
    steps.push(`+ 送料 ${fmt(snap.shipping)} = ${fmt(v)}`);
  }
  if (snap.currency !== opts.targetCurrency) {
    if (!snap.fxRate || snap.fxBase !== opts.targetCurrency) {
      return { comparable: false, value: null, currency: opts.targetCurrency, steps, warnings: [...warnings, `為替レート未設定（${snap.currency}→${opts.targetCurrency}）`] };
    }
    v = v * snap.fxRate;
    steps.push(`× 為替 ${snap.fxRate}（${snap.fxSource ?? '出典不明'}, ${snap.fxAt ?? '日時不明'}）= ${fmt(v)} ${opts.targetCurrency}`);
  }
  return { comparable: true, value: Math.round(v * 100) / 100, currency: opts.targetCurrency, steps, warnings };
}

function fmt(n: number) {
  return (Math.round(n * 100) / 100).toLocaleString('en-US');
}

export function periodLabel(p: BillingPeriod): string {
  return { one_time: '買い切り', monthly: '月額', annual: '年額', unknown: '周期不明' }[p];
}

export function taxLabel(t: TaxMode): string {
  return { included: '・税込', excluded: '・税別', unknown: '・税区分不明' }[t];
}
