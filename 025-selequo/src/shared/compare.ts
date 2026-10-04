// Comparison engine (pure, deterministic). Evidence first; scores are an explained aid.
// Rules: Unknown ≠ 0, conflicting facts are kept side by side, must-have Unknown ≠ Fail,
// and results are phrased as "under these criteria" — never as an automatic winner.

import { computeCost, type CostBasis, type CostResult } from './price';
import { formatValue, valuesEqual } from './normalize';
import type { Attribute, Candidate, Criterion, CriterionTarget, Fact, NormalizedValue, PriceSnapshot, Source } from './types';
import { convert, dimensionOf } from './units';

export const FORMULA_VERSION = 'v1';

export type FactPolicy = 'confirmed_only' | 'include_unreviewed';

export interface CompareOptions {
  factPolicy?: FactPolicy;
  costBasis?: CostBasis;
  seats?: number | null;
  currency?: string;
  includeShipping?: boolean;
  now?: string; // ISO; injected for deterministic source-age output
}

export interface ScenarioInput {
  id: string | null;
  name: string;
  weights?: Record<string, number>;
  mustHaves?: Record<string, boolean>;
  params?: { seats?: number | null; costBasis?: CostBasis; includeShipping?: boolean };
}

export type SourceLite = Pick<Source, 'id' | 'quality' | 'retrievedAt' | 'capturedAt' | 'type' | 'status' | 'title' | 'url'>;

export interface CompareInput {
  candidates: Pick<Candidate, 'id' | 'name' | 'status'>[];
  attributes: Pick<Attribute, 'key' | 'displayName' | 'type' | 'unit' | 'category' | 'groupName' | 'sortOrder' | 'status'>[];
  facts: Fact[];
  criteria: Criterion[];
  prices: PriceSnapshot[];
  sources: SourceLite[];
}

export type CellStatus = 'value' | 'unknown' | 'conflict';

export interface Cell {
  candidateId: string;
  attributeKey: string;
  status: CellStatus;
  display: string;
  values: { display: string; normalized: NormalizedValue | null; factIds: string[]; verified: boolean }[];
  factIds: string[];
  verified: boolean; // at least one confirmed fact backs the shown value
  needsReview: boolean; // unreviewed facts exist
  sourceAgeDays: number | null;
  officialSource: boolean;
}

export interface Row {
  attributeKey: string;
  displayName: string;
  category: string;
  groupName: string | null;
  differs: boolean;
  cells: Cell[];
}

export type MustHaveStatus = 'pass' | 'fail' | 'unknown';

export interface CriterionEval {
  criterionId: string;
  name: string;
  weight: number;
  normalizedWeight: number;
  direction: Criterion['direction'];
  mustHave: boolean;
  perCandidate: {
    candidateId: string;
    input: number | boolean | null;
    inputDisplay: string;
    inputSource: 'fact' | 'price' | null;
    known: boolean;
    reason: string | null; // why unknown
    subScore: number | null; // 0..1
    mustHave: MustHaveStatus | null;
    factIds: string[];
    costSteps?: string[];
  }[];
}

export interface CandidateScore {
  candidateId: string;
  name: string;
  score: number | null; // 0..10 over known criteria
  coverage: number; // 0..1 share of weight with known inputs
  range: [number, number] | null; // [pessimistic, optimistic] if unknowns were worst/best
  mustHave: { pass: number; fail: number; unknown: number; status: MustHaveStatus };
  rank: number | null;
}

export interface CompareResult {
  formulaVersion: string;
  scenario: { id: string | null; name: string };
  rows: Row[];
  missing: { candidateId: string; attributeKey: string }[];
  conflicts: { candidateId: string; attributeKey: string; factIds: string[]; values: string[] }[];
  criteria: CriterionEval[];
  scores: CandidateScore[];
  weightErrors: string[];
  statement: string;
  caveats: string[];
  formula: string[];
  options: Required<Omit<CompareOptions, 'now'>>;
}

const ACTIVE_STATES = new Set(['confirmed', 'candidate']);
const QUALITY_RANK: Record<string, number> = { official: 0, manufacturer: 1, vendor: 2, editorial: 3, marketplace: 4, user_review: 5, manual: 6, unknown: 7 };

export function validateWeights(weights: number[]): string[] {
  const errors: string[] = [];
  if (weights.some((w) => typeof w !== 'number' || !Number.isFinite(w))) errors.push('Weightは数値で指定してください');
  if (weights.some((w) => w < 0 || w > 100)) errors.push('Weightは0〜100の範囲で指定してください');
  if (weights.length > 0 && weights.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) <= 0) errors.push('少なくとも1つのCriteriaに0より大きいWeightが必要です');
  return errors;
}

function groupDistinct(facts: Fact[]): { normalized: NormalizedValue | null; display: string; facts: Fact[] }[] {
  const groups: { normalized: NormalizedValue | null; display: string; facts: Fact[] }[] = [];
  for (const f of facts) {
    const g = groups.find((x) =>
      x.normalized && f.normalizedValue ? valuesEqual(x.normalized, f.normalizedValue) : !x.normalized && !f.normalizedValue && x.display.trim().toLowerCase() === f.rawValue.trim().toLowerCase(),
    );
    if (g) g.facts.push(f);
    else groups.push({ normalized: f.normalizedValue, display: f.normalizedValue ? formatValue(f.normalizedValue) : f.rawValue, facts: [f] });
  }
  return groups;
}

function priceUnitPeriod(v: NormalizedValue | null): string {
  return v && v.kind === 'number' ? v.unit ?? '' : '';
}

export function buildCell(
  candidateId: string,
  attr: { key: string; type: string },
  facts: Fact[],
  sourcesById: Map<string, SourceLite>,
  now: number,
): Cell {
  // deterministic order: stronger sources first (official → … → unknown), then oldest first
  const rank = (f: Fact) => QUALITY_RANK[sourcesById.get(f.sourceId)?.quality ?? 'unknown'] ?? 9;
  const active = facts
    .filter((f) => f.kind === 'fact' && ACTIVE_STATES.has(f.reviewState))
    .sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const base = { candidateId, attributeKey: attr.key };
  if (active.length === 0) {
    return { ...base, status: 'unknown', display: 'Unknown', values: [], factIds: [], verified: false, needsReview: false, sourceAgeDays: null, officialSource: false };
  }
  // Prices are offers/snapshots (different sellers, monthly vs annual), never conflicts; they are listed side by side
  // and compared through price snapshots with an explicit cost basis.
  const buckets = attr.type === 'price' ? [...new Set(active.map((f) => priceUnitPeriod(f.normalizedValue)))].map((u) => active.filter((f) => priceUnitPeriod(f.normalizedValue) === u)) : [active];
  let conflict = false;
  const values: Cell['values'] = [];
  for (const bucket of buckets) {
    const groups = groupDistinct(bucket);
    if (groups.length > 1 && attr.type !== 'price') conflict = true;
    for (const g of groups) values.push({ display: g.display, normalized: g.normalized, factIds: g.facts.map((f) => f.id), verified: g.facts.some((f) => f.reviewState === 'confirmed') });
  }
  const srcs = active.map((f) => sourcesById.get(f.sourceId)).filter(Boolean) as SourceLite[];
  const times = srcs.map((s) => Date.parse(s.retrievedAt ?? s.capturedAt ?? '')).filter((t) => Number.isFinite(t));
  const newest = times.length ? Math.max(...times) : null;
  return {
    ...base,
    status: conflict ? 'conflict' : 'value',
    display: conflict ? values.map((v) => v.display).join(' / ') : values.map((v) => v.display).join(' · '),
    values,
    factIds: active.map((f) => f.id),
    verified: active.some((f) => f.reviewState === 'confirmed'),
    needsReview: active.some((f) => f.reviewState === 'candidate'),
    sourceAgeDays: newest === null ? null : Math.max(0, Math.floor((now - newest) / 86400000)),
    officialSource: srcs.some((s) => s.quality === 'official' || s.quality === 'manufacturer'),
  };
}

function targetMet(target: CriterionTarget, input: number | boolean | string, inputUnit: string | null): boolean | null {
  let tv = target.value;
  if (typeof input === 'number' && typeof tv === 'number' && target.unit && inputUnit && target.unit !== inputUnit) {
    if (dimensionOf(target.unit) !== dimensionOf(inputUnit)) return null;
    tv = convert(tv, target.unit, inputUnit);
  }
  switch (target.op) {
    case '>=':
      return typeof input === 'number' && typeof tv === 'number' ? input >= tv : null;
    case '<=':
      return typeof input === 'number' && typeof tv === 'number' ? input <= tv : null;
    case '>':
      return typeof input === 'number' && typeof tv === 'number' ? input > tv : null;
    case '<':
      return typeof input === 'number' && typeof tv === 'number' ? input < tv : null;
    case '=':
      return input === tv;
    case 'includes':
      return String(input).toLowerCase().includes(String(tv).toLowerCase());
  }
}

export function compare(input: CompareInput, scenario: ScenarioInput | null = null, options: CompareOptions = {}): CompareResult {
  const opts = {
    factPolicy: options.factPolicy ?? 'confirmed_only',
    costBasis: scenario?.params?.costBasis ?? options.costBasis ?? 'annual_total',
    seats: scenario?.params?.seats ?? options.seats ?? null,
    currency: options.currency ?? 'JPY',
    includeShipping: scenario?.params?.includeShipping ?? options.includeShipping ?? false,
  } as const;
  const now = options.now ? Date.parse(options.now) : Date.now();
  const sourcesById = new Map(input.sources.map((s) => [s.id, s]));
  const liveSourceIds = new Set(input.sources.filter((s) => s.status !== 'deleted').map((s) => s.id));
  const facts = input.facts.filter((f) => liveSourceIds.has(f.sourceId));
  const candidates = [...input.candidates];
  const attrs = input.attributes.filter((a) => a.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

  // ---- table
  const factsBy = new Map<string, Fact[]>();
  for (const f of facts) {
    if (!f.attributeKey) continue;
    const k = `${f.candidateId}|${f.attributeKey}`;
    (factsBy.get(k) ?? factsBy.set(k, []).get(k)!).push(f);
  }
  const rows: Row[] = attrs.map((a) => {
    const cells = candidates.map((c) => buildCell(c.id, a, factsBy.get(`${c.id}|${a.key}`) ?? [], sourcesById, now));
    const known = cells.filter((c) => c.status === 'value');
    const distinct: NormalizedValue[] = [];
    let differs = false;
    for (const c of known) {
      const v = c.values[0]?.normalized;
      if (!v) continue;
      if (distinct.length && !distinct.some((d) => valuesEqual(d, v))) differs = true;
      distinct.push(v);
    }
    if (cells.some((c) => c.status === 'conflict')) differs = true;
    return { attributeKey: a.key, displayName: a.displayName, category: a.category, groupName: a.groupName, differs, cells };
  });
  const missing = rows.flatMap((r) => r.cells.filter((c) => c.status === 'unknown').map((c) => ({ candidateId: c.candidateId, attributeKey: r.attributeKey })));
  const conflicts = rows.flatMap((r) =>
    r.cells.filter((c) => c.status === 'conflict').map((c) => ({ candidateId: c.candidateId, attributeKey: r.attributeKey, factIds: c.factIds, values: c.values.map((v) => v.display) })),
  );
  const cellIndex = new Map(rows.flatMap((r) => r.cells.map((c) => [`${c.candidateId}|${r.attributeKey}`, c] as const)));
  const attrByKey = new Map(attrs.map((a) => [a.key, a]));

  // ---- criteria inputs
  const criteria = input.criteria.filter((c) => c.status === 'active');
  const effWeight = (c: Criterion) => scenario?.weights?.[c.id] ?? c.weight;
  const effMust = (c: Criterion) => scenario?.mustHaves?.[c.id] ?? c.mustHave;
  const weightErrors = validateWeights(criteria.filter((c) => c.direction !== 'none').map(effWeight));
  const totalW = criteria.filter((c) => c.direction !== 'none').reduce((s, c) => s + Math.max(0, effWeight(c) || 0), 0);

  const priceSnapsFor = (candidateId: string) => {
    const confirmedFactIds = new Set(facts.filter((f) => f.reviewState === 'confirmed' || opts.factPolicy === 'include_unreviewed').map((f) => f.id));
    const snaps = input.prices.filter(
      (p) => p.candidateId === candidateId && (!p.sourceId || liveSourceIds.has(p.sourceId)) && (!p.factId || confirmedFactIds.has(p.factId)),
    );
    // latest snapshot per offer type (period/per-seat)
    const latest = new Map<string, PriceSnapshot>();
    for (const s of snaps) {
      const k = `${s.sourceId ?? s.id}|${s.billingPeriod}|${s.perSeat}`;
      const cur = latest.get(k);
      if (!cur || Date.parse(s.capturedAt) > Date.parse(cur.capturedAt)) latest.set(k, s);
    }
    return [...latest.values()];
  };

  const evals: CriterionEval[] = criteria.map((cr) => {
    const w = Math.max(0, effWeight(cr) || 0);
    const per = candidates.map((cand) => {
      let input: number | boolean | null = null;
      let inputDisplay = 'Unknown';
      let inputSource: 'fact' | 'price' | null = null;
      let reason: string | null = 'リンクされた属性に値がありません';
      let factIds: string[] = [];
      let unit: string | null = null;
      let costSteps: string[] | undefined;
      for (const key of cr.linkedAttributes) {
        const attr = attrByKey.get(key);
        if (attr?.type === 'price') {
          const snaps = priceSnapsFor(cand.id);
          const results: (CostResult & { snap: PriceSnapshot })[] = snaps.map((s) => ({ ...computeCost(s, { basis: opts.costBasis, seats: opts.seats, targetCurrency: opts.currency, includeShipping: opts.includeShipping }), snap: s }));
          const ok = results.filter((r) => r.comparable).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
          if (ok.length) {
            input = ok[0].value;
            unit = opts.currency;
            inputDisplay = `${opts.currency === 'JPY' ? '¥' : opts.currency + ' '}${(ok[0].value ?? 0).toLocaleString('en-US')}`;
            inputSource = 'price';
            reason = null;
            factIds = ok[0].snap.factId ? [ok[0].snap.factId] : [];
            costSteps = [...ok[0].steps, ...(ok.length > 1 ? [`比較可能な${ok.length}件の料金形態のうち最安を使用`] : []), ...ok[0].warnings.map((w) => `注意: ${w}`)];
            break;
          }
          if (results.length) {
            reason = results.flatMap((r) => r.warnings).join(' / ') || '比較可能な価格がありません';
            costSteps = results.flatMap((r) => r.steps);
          }
          continue;
        }
        const cell = cellIndex.get(`${cand.id}|${key}`);
        if (!cell || cell.status === 'unknown') continue;
        if (cell.status === 'conflict') {
          reason = 'Conflict（未解決）のため評価対象外';
          factIds = cell.factIds;
          break;
        }
        const v = cell.values[0];
        if (opts.factPolicy === 'confirmed_only' && !v.verified) {
          reason = '未確認Factのみ（Confirmedが必要）';
          factIds = v.factIds;
          continue;
        }
        if (!v.normalized) {
          reason = '値を正規化できません（要確認）';
          factIds = v.factIds;
          continue;
        }
        if (v.normalized.kind === 'number') {
          input = v.normalized.value;
          unit = v.normalized.unit;
        } else if (v.normalized.kind === 'bool') input = v.normalized.value;
        else {
          // text values are only usable for 'includes' targets
          if (cr.target?.op === 'includes') input = (v.normalized.value as unknown as number) ?? null;
          else {
            reason = 'テキスト値は数値比較できません';
            factIds = v.factIds;
            continue;
          }
        }
        inputDisplay = v.display;
        inputSource = 'fact';
        reason = null;
        factIds = v.factIds;
        break;
      }
      const known = input !== null;
      let mh: MustHaveStatus | null = null;
      if (effMust(cr)) {
        if (!known) mh = 'unknown';
        else if (cr.target) {
          const met = targetMet(cr.target, input as number | boolean, unit);
          mh = met === null ? 'unknown' : met ? 'pass' : 'fail';
        } else if (typeof input === 'boolean') mh = input ? 'pass' : 'fail';
        else mh = 'pass';
      }
      return { candidateId: cand.id, input, inputDisplay, inputSource, known, reason, subScore: null as number | null, mustHave: mh, factIds, costSteps, unit };
    });
    // sub-scores
    const knownNums = per.filter((p) => p.known && typeof p.input === 'number').map((p) => p.input as number);
    const min = Math.min(...knownNums);
    const max = Math.max(...knownNums);
    for (const p of per) {
      if (!p.known) continue;
      switch (cr.direction) {
        case 'higher_better':
          if (typeof p.input === 'number') p.subScore = max === min ? 1 : (p.input - min) / (max - min);
          break;
        case 'lower_better':
          if (typeof p.input === 'number') p.subScore = max === min ? 1 : (max - p.input) / (max - min);
          break;
        case 'boolean':
          p.subScore = p.input === true ? 1 : p.input === false ? 0 : null;
          break;
        case 'target':
          if (cr.target) {
            const met = targetMet(cr.target, p.input as number | boolean, p.unit);
            p.subScore = met === null ? null : met ? 1 : 0;
          }
          break;
        case 'none':
          p.subScore = null;
      }
      if (p.subScore !== null) p.subScore = Math.round(p.subScore * 10000) / 10000;
    }
    return {
      criterionId: cr.id,
      name: cr.name,
      weight: w,
      normalizedWeight: totalW > 0 && cr.direction !== 'none' ? Math.round((w / totalW) * 10000) / 10000 : 0,
      direction: cr.direction,
      mustHave: effMust(cr),
      perCandidate: per.map(({ unit: _u, ...rest }) => rest),
    };
  });

  // ---- scores
  const scored = weightErrors.length ? [] : evals.filter((e) => e.direction !== 'none' && e.weight > 0);
  const scores: CandidateScore[] = candidates.map((cand) => {
    let num = 0;
    let knownW = 0;
    for (const e of scored) {
      const p = e.perCandidate.find((x) => x.candidateId === cand.id)!;
      if (p.subScore === null) continue;
      num += e.weight * p.subScore;
      knownW += e.weight;
    }
    const all = scored.reduce((s, e) => s + e.weight, 0);
    const mh = evals.filter((e) => e.mustHave).map((e) => e.perCandidate.find((x) => x.candidateId === cand.id)!.mustHave);
    const pass = mh.filter((m) => m === 'pass').length;
    const fail = mh.filter((m) => m === 'fail').length;
    const unknown = mh.filter((m) => m === 'unknown').length;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      candidateId: cand.id,
      name: cand.name,
      score: knownW > 0 ? r2((10 * num) / knownW) : null,
      coverage: all > 0 ? r2(knownW / all) : 0,
      range: all > 0 && knownW > 0 ? [r2((10 * num) / all), r2((10 * (num + (all - knownW))) / all)] : null,
      mustHave: { pass, fail, unknown, status: fail > 0 ? 'fail' : unknown > 0 ? 'unknown' : 'pass' },
      rank: null,
    };
  });
  // candidates failing a must-have keep their score but are not ranked (Unknown is NOT a fail and stays ranked)
  const ordered = scores.filter((s) => s.score !== null && s.mustHave.status !== 'fail').sort((a, b) => b.score! - a.score! || a.name.localeCompare(b.name));
  let rank = 0;
  let prev: number | null = null;
  ordered.forEach((s, i) => {
    if (s.score !== prev) rank = i + 1;
    s.rank = rank;
    prev = s.score;
  });

  // ---- statement (never declares a winner)
  const caveats: string[] = [];
  let statement: string;
  const label = scenario?.name ? `Scenario「${scenario.name}」の` : '';
  if (weightErrors.length) statement = `Weight設定にエラーがあるためスコアを計算していません：${weightErrors.join(' / ')}`;
  else if (!ordered.length && scores.some((x) => x.score !== null)) statement = `${label}Criteria設定では、すべての候補がいずれかのMust-haveを満たしていません（順位を付けていません）。`;
  else if (!ordered.length) statement = `${label}Criteria設定では、スコア計算に使える確認済みの値がまだありません。`;
  else {
    const top = ordered.filter((s) => s.rank === 1);
    statement =
      top.length > 1
        ? `この${label}Criteria設定では ${top.map((t) => `「${t.name}」`).join('と')} のスコアが同点で最も高くなります（${top[0].score}/10）。`
        : `この${label}Criteria設定では「${top[0].name}」のスコアが最も高くなります（${top[0].score}/10、カバー率 ${Math.round(top[0].coverage * 100)}%）。`;
    if (top.some((t) => t.coverage < 1)) caveats.push('Unknownを含むCriteriaはスコアから除外しています（Unknownを0点として扱っていません）。範囲は Unknown が最悪/最良だった場合の値です。');
    const mhFail = scores.filter((s) => s.mustHave.status === 'fail').map((s) => s.name);
    const mhUnknown = scores.filter((s) => s.mustHave.status === 'unknown').map((s) => s.name);
    if (mhFail.length) caveats.push(`Must-have未達（順位の対象外）：${mhFail.join('、')}`);
    if (mhUnknown.length) caveats.push(`Must-have未確認（Unknown）：${mhUnknown.join('、')} — 不足情報であり不合格ではありません。`);
  }
  if (conflicts.length) caveats.push(`未解決のConflictが${conflicts.length}件あります。該当値はスコアから除外しています。`);
  caveats.push('スコアは判断材料の一つです。最終判断は根拠（Evidence）を確認したうえで人が行います。');

  const formula = [
    `formula ${FORMULA_VERSION}: score = 10 × Σ(wᵢ × sᵢ) / Σ(wᵢ)  — 値が既知のCriteriaのみで計算`,
    'sᵢ（0〜1）: higher_better = (v − min)/(max − min)、lower_better = (max − v)/(max − min)、max = min の場合は 1',
    'target: 目標を満たせば 1、満たさなければ 0。boolean: あり = 1、なし = 0。',
    'カバー率 = 既知Criteriaの重み合計 / 全Criteriaの重み合計。範囲 = Unknownを0とした場合〜1とした場合。',
    `Fact採用方針: ${opts.factPolicy === 'confirmed_only' ? 'Confirmed のFactのみ' : '未確認Factも含む'}。Conflict中の値は除外。`,
    `価格: 基準 ${opts.costBasis === 'annual_total' ? '年額合計' : opts.costBasis === 'monthly_equivalent' ? '月額換算' : '表示価格'}、通貨 ${opts.currency}${opts.seats ? `、席数 ${opts.seats}` : ''}。換算手順は各セルに表示。`,
    'Must-have: Pass / Fail / Unknown。値が不明な場合は Unknown（Failにはしない）。',
  ];

  return {
    formulaVersion: FORMULA_VERSION,
    scenario: { id: scenario?.id ?? null, name: scenario?.name ?? '既定' },
    rows,
    missing,
    conflicts,
    criteria: evals,
    scores,
    weightErrors,
    statement,
    caveats,
    formula,
    options: opts,
  };
}

export interface ScenarioMatrix {
  scenarios: { id: string | null; name: string; topCandidateIds: string[]; scores: CandidateScore[]; statement: string }[];
  resultsDiffer: boolean;
}

export function compareScenarios(input: CompareInput, scenarios: ScenarioInput[], options: CompareOptions = {}): ScenarioMatrix {
  const out = scenarios.map((s) => {
    const r = compare(input, s, options);
    return { id: s.id, name: s.name, topCandidateIds: r.scores.filter((x) => x.rank === 1).map((x) => x.candidateId), scores: r.scores, statement: r.statement };
  });
  const tops = new Set(out.map((o) => o.topCandidateIds.slice().sort().join(',')));
  return { scenarios: out, resultsDiffer: tops.size > 1 };
}
