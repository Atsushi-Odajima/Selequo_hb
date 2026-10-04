// Decision Brief: a structured, cited summary for a *human* decision. Renderers for Markdown / HTML / TXT / JSON.
// The brief never states that AI made the decision; decision fields are copied from the human Decision Record.

import type { CompareResult, ScenarioMatrix } from './compare';
import { periodLabel, taxLabel } from './price';
import type { BillingPeriod, Decision, PriceSnapshot, SourceRange, TaxMode } from './types';

export const BRIEF_SCHEMA = 'selequo.brief/v1';

export interface BriefEvidence {
  n: number;
  factId: string;
  candidate: string;
  attribute: string;
  value: string;
  verified: boolean;
  source: { title: string | null; url: string | null; type: string; quality: string; retrievedAt: string | null; locator: string };
}

export interface BriefContent {
  schema: string;
  generatedAt: string;
  project: { title: string; purpose: string | null; category: string | null; deadline: string | null; currency: string };
  candidates: { id: string; name: string; provider: string | null }[];
  criteria: { name: string; weight: number; normalizedWeight: number; direction: string; mustHave: boolean; target: string | null }[];
  mustHaves: { criterion: string; results: { candidate: string; status: string; value: string; cites: number[] }[] }[];
  keyDifferences: { attribute: string; values: { candidate: string; display: string; verified: boolean; status: string; cites: number[] }[] }[];
  unknowns: { candidate: string; attribute: string }[];
  conflicts: { candidate: string; attribute: string; values: string[]; cites: number[] }[];
  prices: { candidate: string; display: string; capturedAt: string; cites: number[] }[];
  scenarioResults: { scenario: string; statement: string; ranks: { candidate: string; score: number | null; coverage: number; rank: number | null; mustHave: string }[] }[];
  scenarioResultsDiffer: boolean;
  tradeoffs: string[];
  openQuestions: { text: string; candidate: string | null }[];
  evidence: BriefEvidence[];
  statement: string;
  caveats: string[];
  formula: string[];
  decision: null | {
    status: string;
    chosen: string | null;
    reason: string;
    assumptions: string | null;
    expectedOutcome: string | null;
    reviewDate: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    actualResult: string | null;
    lessons: string | null;
  };
  disclaimer: string;
}

export interface BriefFactRef {
  id: string;
  sourceId: string;
  sourceRange: SourceRange;
}
export interface BriefSourceRef {
  id: string;
  title: string | null;
  url: string | null;
  type: string;
  quality: string;
  retrievedAt: string | null;
  capturedAt: string | null;
  createdByName?: string | null;
}

export function locatorOf(r: SourceRange): string {
  switch (r.type) {
    case 'pdf':
      return `p.${r.page}`;
    case 'image':
      return r.region ? `画像領域 (${Math.round(r.region.x * 100)}%, ${Math.round(r.region.y * 100)}%, ${Math.round(r.region.w * 100)}%×${Math.round(r.region.h * 100)}%)` : '画像';
    case 'csv':
      return `行${r.row} 列「${r.column}」`;
    case 'manual':
      return `手入力: ${r.by}`;
    default:
      return `本文 ${r.start}–${r.end}`;
  }
}

export function buildBrief(args: {
  project: { title: string; purpose: string | null; category: string | null; deadline: string | null; currency: string };
  compare: CompareResult;
  candidates: { id: string; name: string; provider: string | null }[];
  criteria: { id: string; name: string; target: { op: string; value: unknown; unit?: string | null } | null }[];
  facts: BriefFactRef[];
  sources: BriefSourceRef[];
  prices: PriceSnapshot[];
  matrix: ScenarioMatrix;
  questions: { text: string; candidateId: string | null; status: string }[];
  decision: (Decision & { decidedByName?: string | null }) | null;
  now?: string;
}): BriefContent {
  const cand = new Map(args.candidates.map((c) => [c.id, c.name]));
  const factById = new Map(args.facts.map((f) => [f.id, f]));
  const srcById = new Map(args.sources.map((s) => [s.id, s]));
  const evidence: BriefEvidence[] = [];
  const evIndex = new Map<string, number>();
  const cite = (factIds: string[], candidateId: string, attribute: string, value: string, verified: boolean): number[] =>
    factIds
      .map((fid) => {
        if (evIndex.has(fid)) return evIndex.get(fid)!;
        const f = factById.get(fid);
        const s = f ? srcById.get(f.sourceId) : undefined;
        if (!f || !s) return null;
        const n = evidence.length + 1;
        evidence.push({
          n,
          factId: fid,
          candidate: cand.get(candidateId) ?? '',
          attribute,
          value,
          verified,
          source: { title: s.title, url: s.url, type: s.type, quality: s.quality, retrievedAt: s.retrievedAt ?? s.capturedAt, locator: locatorOf(f.sourceRange) },
        });
        evIndex.set(fid, n);
        return n;
      })
      .filter((n): n is number => n !== null);

  const r = args.compare;
  const keyDifferences = r.rows
    .filter((row) => row.differs)
    .map((row) => ({
      attribute: row.displayName,
      values: row.cells.map((c) => ({
        candidate: cand.get(c.candidateId) ?? '',
        display: c.status === 'unknown' ? 'Unknown' : c.display,
        verified: c.verified,
        status: c.status,
        cites: cite(c.factIds, c.candidateId, row.displayName, c.display, c.verified),
      })),
    }));
  const attrName = new Map(r.rows.map((row) => [row.attributeKey, row.displayName]));
  const conflicts = r.conflicts.map((c) => ({ candidate: cand.get(c.candidateId) ?? '', attribute: attrName.get(c.attributeKey) ?? c.attributeKey, values: c.values, cites: cite(c.factIds, c.candidateId, attrName.get(c.attributeKey) ?? c.attributeKey, c.values.join(' / '), false) }));
  const critTarget = new Map(args.criteria.map((c) => [c.id, c.target ? `${c.target.op} ${String(c.target.value)}${c.target.unit ? ' ' + c.target.unit : ''}` : null]));
  const mustHaves = r.criteria
    .filter((c) => c.mustHave)
    .map((c) => ({
      criterion: c.name,
      results: c.perCandidate.map((p) => ({ candidate: cand.get(p.candidateId) ?? '', status: p.mustHave ?? 'unknown', value: p.inputDisplay, cites: cite(p.factIds, p.candidateId, c.name, p.inputDisplay, true) })),
    }));
  const latest = new Map<string, PriceSnapshot>();
  for (const p of args.prices) {
    const k = `${p.candidateId}|${p.billingPeriod}|${p.perSeat}`;
    const cur = latest.get(k);
    if (!cur || Date.parse(p.capturedAt) > Date.parse(cur.capturedAt)) latest.set(k, p);
  }
  const prices = [...latest.values()].map((p) => ({
    candidate: cand.get(p.candidateId) ?? '',
    display: `${p.currency === 'JPY' ? '¥' : p.currency + ' '}${Number(p.amount).toLocaleString('en-US')}（${periodLabel(p.billingPeriod as BillingPeriod)}${p.perSeat ? '・1席あたり' : ''}${taxLabel(p.tax as TaxMode)}${p.shipping != null ? `・送料 ${p.shipping}` : ''}）`,
    capturedAt: p.capturedAt,
    cites: p.factId ? cite([p.factId], p.candidateId, '価格', String(p.amount), true) : [],
  }));
  // Trade-offs: per numeric criterion, which candidate is best/worst (descriptive, not a recommendation)
  const tradeoffs: string[] = [];
  for (const c of r.criteria) {
    if (c.direction !== 'higher_better' && c.direction !== 'lower_better') continue;
    const known = c.perCandidate.filter((p) => p.subScore !== null);
    if (known.length < 2) continue;
    const best = known.filter((p) => p.subScore === 1).map((p) => cand.get(p.candidateId));
    const worst = known.filter((p) => p.subScore === 0).map((p) => cand.get(p.candidateId));
    if (best.length && worst.length && best.length < known.length) tradeoffs.push(`${c.name}: ${best.join('・')} が有利、${worst.join('・')} が不利（${known.map((p) => `${cand.get(p.candidateId)} ${p.inputDisplay}`).join(' / ')}）`);
  }
  const d = args.decision;
  return {
    schema: BRIEF_SCHEMA,
    generatedAt: args.now ?? new Date().toISOString(),
    project: args.project,
    candidates: args.candidates.map((c) => ({ id: c.id, name: c.name, provider: c.provider })),
    criteria: r.criteria.map((c) => ({ name: c.name, weight: c.weight, normalizedWeight: c.normalizedWeight, direction: c.direction, mustHave: c.mustHave, target: critTarget.get(c.criterionId) ?? null })),
    mustHaves,
    keyDifferences,
    unknowns: r.missing.map((m) => ({ candidate: cand.get(m.candidateId) ?? '', attribute: attrName.get(m.attributeKey) ?? m.attributeKey })),
    conflicts,
    prices,
    scenarioResults: args.matrix.scenarios.map((s) => ({
      scenario: s.name,
      statement: s.statement,
      ranks: s.scores.map((x) => ({ candidate: x.name, score: x.score, coverage: x.coverage, rank: x.rank, mustHave: x.mustHave.status })),
    })),
    scenarioResultsDiffer: args.matrix.resultsDiffer,
    tradeoffs,
    openQuestions: args.questions.filter((q) => q.status === 'open').map((q) => ({ text: q.text, candidate: q.candidateId ? (cand.get(q.candidateId) ?? null) : null })),
    evidence,
    statement: r.statement,
    caveats: r.caveats,
    formula: r.formula,
    decision: d
      ? {
          status: d.status,
          chosen: d.chosenCandidateId ? (cand.get(d.chosenCandidateId) ?? null) : null,
          reason: d.reason,
          assumptions: d.assumptions,
          expectedOutcome: d.expectedOutcome,
          reviewDate: d.reviewDate,
          decidedBy: d.decidedByName ?? null,
          decidedAt: d.decidedAt,
          actualResult: d.actualResult,
          lessons: d.lessons,
        }
      : null,
    disclaimer: 'この資料は比較検討の材料を整理したものです。スコアは設定したCriteria/Weightでの参考値であり、AIが候補を決定したものではありません。最終判断は人が行います。',
  };
}

// ---------------- renderers

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const mdCell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const cites = (ns: number[]) => (ns.length ? ns.map((n) => `[${n}]`).join('') : '');
const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);
const statusJa = (s: string) => ({ pass: 'Pass', fail: 'Fail', unknown: 'Unknown' })[s] ?? s;

export function briefToMarkdown(b: BriefContent): string {
  const L: string[] = [];
  L.push(`# Decision Brief: ${b.project.title}`, '');
  L.push(`作成日時: ${b.generatedAt}`, '');
  if (b.project.purpose) L.push(`## 目的`, '', b.project.purpose, '');
  L.push('## 候補', '', ...b.candidates.map((c) => `- ${c.name}${c.provider ? `（${c.provider}）` : ''}`), '');
  L.push('## Criteria', '', '| Criteria | Weight | 正規化Weight | 方向 | Must-have | 目標 |', '|---|---|---|---|---|---|');
  for (const c of b.criteria) L.push(`| ${mdCell(c.name)} | ${c.weight} | ${Math.round(c.normalizedWeight * 100)}% | ${c.direction} | ${c.mustHave ? '✓' : ''} | ${mdCell(c.target ?? '')} |`);
  L.push('');
  if (b.mustHaves.length) {
    L.push('## Must-have', '');
    for (const m of b.mustHaves) L.push(`- **${m.criterion}**: ${m.results.map((r) => `${r.candidate} = ${statusJa(r.status)}（${r.value}）${cites(r.cites)}`).join(' / ')}`);
    L.push('');
  }
  L.push('## 主な違い（Key Differences）', '');
  if (b.keyDifferences.length) {
    L.push(`| 項目 | ${b.candidates.map((c) => mdCell(c.name)).join(' | ')} |`, `|---|${b.candidates.map(() => '---').join('|')}|`);
    for (const k of b.keyDifferences) L.push(`| ${mdCell(k.attribute)} | ${k.values.map((v) => `${mdCell(v.display)}${v.verified || v.status !== 'value' ? '' : '（未確認）'} ${cites(v.cites)}`).join(' | ')} |`);
  } else L.push('違いのある項目はありません。');
  L.push('');
  L.push('## Unknown（不足情報）', '', ...(b.unknowns.length ? b.unknowns.map((u) => `- ${u.candidate}: ${u.attribute}`) : ['なし']), '');
  L.push('## Conflict（情報の食い違い）', '', ...(b.conflicts.length ? b.conflicts.map((c) => `- ${c.candidate} / ${c.attribute}: ${c.values.join(' vs ')} ${cites(c.cites)}`) : ['なし']), '');
  L.push('## Price Snapshot', '', ...(b.prices.length ? b.prices.map((p) => `- ${p.candidate}: ${p.display} — 取得 ${p.capturedAt} ${cites(p.cites)}`) : ['価格情報なし']), '');
  L.push('## Scenario別の結果', '');
  for (const s of b.scenarioResults) {
    L.push(`### ${s.scenario}`, '', s.statement, '');
    for (const r of s.ranks) L.push(`- ${r.candidate}: ${r.score ?? 'N/A'}/10（カバー率 ${Math.round(r.coverage * 100)}%、Must-have ${statusJa(r.mustHave)}）`);
    L.push('');
  }
  if (b.scenarioResultsDiffer) L.push('> 条件（Scenario）によってスコアが最も高い候補が変わります。', '');
  if (b.tradeoffs.length) L.push('## Trade-offs', '', ...b.tradeoffs.map((t) => `- ${t}`), '');
  if (b.openQuestions.length) L.push('## 未解決の質問', '', ...b.openQuestions.map((q) => `- ${q.candidate ? `[${q.candidate}] ` : ''}${q.text}`), '');
  L.push('## 判断（User Decision）', '');
  if (b.decision && b.decision.status !== 'draft') {
    L.push(`- 選択: ${b.decision.chosen ?? '（未選択）'}`, `- 理由: ${b.decision.reason}`, `- 前提: ${b.decision.assumptions ?? '-'}`, `- 期待する結果: ${b.decision.expectedOutcome ?? '-'}`, `- 判断者: ${b.decision.decidedBy ?? '-'}`, `- 判断日時: ${b.decision.decidedAt ?? '-'}`, `- 振り返り予定日: ${b.decision.reviewDate ?? '-'}`);
    if (b.decision.actualResult) L.push(`- 実際の結果: ${b.decision.actualResult}`);
    if (b.decision.lessons) L.push(`- 学び: ${b.decision.lessons}`);
  } else L.push('まだ判断は記録されていません。');
  L.push('');
  L.push('## 計算方法', '', ...b.formula.map((f) => `- ${f}`), '', ...b.caveats.map((c) => `> ${c}`), '');
  L.push('## Evidence（出典）', '');
  for (const e of b.evidence) {
    const url = safeUrl(e.source.url);
    L.push(`${e.n}. ${e.candidate} / ${e.attribute}: ${e.value}${e.verified ? '' : '（未確認）'} — ${e.source.title ?? e.source.type}${url ? ` <${url}>` : ''}（${e.source.quality}、${e.source.locator}、取得 ${e.source.retrievedAt ?? '-'}）`);
  }
  L.push('', '---', b.disclaimer, '');
  return L.join('\n');
}

export function briefToText(b: BriefContent): string {
  return briefToMarkdown(b)
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^> /gm, '※ ')
    .replace(/^\|---.*$/gm, '')
    .replace(/\\\|/g, '|');
}

export function briefToHtml(b: BriefContent): string {
  const c = (ns: number[]) => ns.map((n) => `<a class="cite" href="#ev-${n}">[${n}]</a>`).join('');
  const rows = (cells: string[]) => `<tr>${cells.join('')}</tr>`;
  const h: string[] = [];
  h.push(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Decision Brief — ${esc(b.project.title)}</title><style>${BRIEF_CSS}</style></head><body><main>`);
  h.push(`<header><div class="brand">Selequo</div><h1>Decision Brief</h1><p class="title">${esc(b.project.title)}</p><p class="meta">作成 ${esc(b.generatedAt)}</p></header>`);
  if (b.project.purpose) h.push(`<section><h2>目的</h2><p>${esc(b.project.purpose)}</p></section>`);
  h.push(`<section><h2>候補</h2><ul>${b.candidates.map((x) => `<li>${esc(x.name)}${x.provider ? `（${esc(x.provider)}）` : ''}</li>`).join('')}</ul></section>`);
  h.push(`<section><h2>Criteria</h2><table><thead><tr><th>Criteria</th><th>Weight</th><th>正規化</th><th>方向</th><th>Must-have</th><th>目標</th></tr></thead><tbody>${b.criteria
    .map((x) => rows([`<td>${esc(x.name)}</td>`, `<td>${x.weight}</td>`, `<td>${Math.round(x.normalizedWeight * 100)}%</td>`, `<td>${esc(x.direction)}</td>`, `<td>${x.mustHave ? '✓' : ''}</td>`, `<td>${esc(x.target ?? '')}</td>`]))
    .join('')}</tbody></table></section>`);
  if (b.mustHaves.length)
    h.push(`<section><h2>Must-have</h2><ul>${b.mustHaves.map((m) => `<li><b>${esc(m.criterion)}</b>: ${m.results.map((r) => `${esc(r.candidate)} <span class="mh ${esc(r.status)}">${statusJa(r.status)}</span>（${esc(r.value)}）${c(r.cites)}`).join(' / ')}</li>`).join('')}</ul></section>`);
  h.push(
    `<section><h2>主な違い</h2>${
      b.keyDifferences.length
        ? `<table><thead><tr><th>項目</th>${b.candidates.map((x) => `<th>${esc(x.name)}</th>`).join('')}</tr></thead><tbody>${b.keyDifferences
            .map((k) => rows([`<th>${esc(k.attribute)}</th>`, ...k.values.map((v) => `<td class="${esc(v.status)}">${esc(v.display)}${v.verified || v.status !== 'value' ? '' : ' <small>（未確認）</small>'} ${c(v.cites)}</td>`)]))
            .join('')}</tbody></table>`
        : '<p>違いのある項目はありません。</p>'
    }</section>`,
  );
  h.push(`<section><h2>Unknown（不足情報）</h2>${b.unknowns.length ? `<ul>${b.unknowns.map((u) => `<li>${esc(u.candidate)}: ${esc(u.attribute)}</li>`).join('')}</ul>` : '<p>なし</p>'}</section>`);
  h.push(`<section><h2>Conflict</h2>${b.conflicts.length ? `<ul>${b.conflicts.map((x) => `<li>${esc(x.candidate)} / ${esc(x.attribute)}: ${x.values.map(esc).join(' vs ')} ${c(x.cites)}</li>`).join('')}</ul>` : '<p>なし</p>'}</section>`);
  h.push(`<section><h2>Price Snapshot</h2>${b.prices.length ? `<ul>${b.prices.map((p) => `<li>${esc(p.candidate)}: ${esc(p.display)} <small>取得 ${esc(p.capturedAt)}</small> ${c(p.cites)}</li>`).join('')}</ul>` : '<p>価格情報なし</p>'}</section>`);
  h.push(
    `<section><h2>Scenario別の結果</h2>${b.scenarioResults
      .map(
        (s) =>
          `<h3>${esc(s.scenario)}</h3><p>${esc(s.statement)}</p><table><thead><tr><th>候補</th><th>スコア</th><th>カバー率</th><th>Must-have</th></tr></thead><tbody>${s.ranks
            .map((r) => rows([`<td>${esc(r.candidate)}</td>`, `<td>${r.score ?? 'N/A'}</td>`, `<td>${Math.round(r.coverage * 100)}%</td>`, `<td>${statusJa(r.mustHave)}</td>`]))
            .join('')}</tbody></table>`,
      )
      .join('')}${b.scenarioResultsDiffer ? '<p class="note">条件（Scenario）によってスコアが最も高い候補が変わります。</p>' : ''}</section>`,
  );
  if (b.tradeoffs.length) h.push(`<section><h2>Trade-offs</h2><ul>${b.tradeoffs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`);
  if (b.openQuestions.length) h.push(`<section><h2>未解決の質問</h2><ul>${b.openQuestions.map((q) => `<li>${q.candidate ? `[${esc(q.candidate)}] ` : ''}${esc(q.text)}</li>`).join('')}</ul></section>`);
  const d = b.decision;
  h.push(
    `<section class="decision"><h2>判断（User Decision）</h2>${
      d && d.status !== 'draft'
        ? `<dl><dt>選択</dt><dd>${esc(d.chosen ?? '（未選択）')}</dd><dt>理由</dt><dd>${esc(d.reason)}</dd><dt>前提</dt><dd>${esc(d.assumptions ?? '-')}</dd><dt>期待する結果</dt><dd>${esc(d.expectedOutcome ?? '-')}</dd><dt>判断者</dt><dd>${esc(d.decidedBy ?? '-')}</dd><dt>判断日時</dt><dd>${esc(d.decidedAt ?? '-')}</dd><dt>振り返り予定日</dt><dd>${esc(d.reviewDate ?? '-')}</dd>${d.actualResult ? `<dt>実際の結果</dt><dd>${esc(d.actualResult)}</dd>` : ''}${d.lessons ? `<dt>学び</dt><dd>${esc(d.lessons)}</dd>` : ''}</dl>`
        : '<p>まだ判断は記録されていません。</p>'
    }</section>`,
  );
  h.push(`<section><h2>計算方法</h2><ul>${b.formula.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>${b.caveats.map((x) => `<p class="note">${esc(x)}</p>`).join('')}</section>`);
  h.push(
    `<section><h2>Evidence（出典）</h2><ol class="evidence">${b.evidence
      .map((e) => {
        const url = safeUrl(e.source.url);
        return `<li id="ev-${e.n}">${esc(e.candidate)} / ${esc(e.attribute)}: <b>${esc(e.value)}</b>${e.verified ? '' : ' <small>（未確認）</small>'} — ${url ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(e.source.title ?? url)}</a>` : esc(e.source.title ?? e.source.type)} <small>（${esc(e.source.quality)}・${esc(e.source.locator)}・取得 ${esc(e.source.retrievedAt ?? '-')}）</small></li>`;
      })
      .join('')}</ol></section>`,
  );
  h.push(`<footer><p>${esc(b.disclaimer)}</p></footer></main></body></html>`);
  return h.join('\n');
}

const BRIEF_CSS = `
:root{--ink:#0B0F1A;--ultra:#1E3A8A;--chart:#C7F464;--mist:#E8EAF3;--lav:#C7C8E6}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:14px/1.6 Inter,"Hiragino Sans","Noto Sans JP","IPAGothic",system-ui,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 20px}header{border-bottom:3px solid var(--ultra);padding-bottom:12px;margin-bottom:20px}
.brand{font-weight:800;color:var(--ultra);letter-spacing:.02em}h1{margin:4px 0 0;font-size:26px}.title{font-size:18px;margin:4px 0}.meta{color:#555;font-size:12px;margin:0}
h2{font-size:17px;border-left:4px solid var(--chart);padding-left:8px;margin:28px 0 10px}h3{font-size:15px;margin:16px 0 6px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--lav);padding:6px 8px;text-align:left;vertical-align:top}thead th{background:var(--mist)}
td.unknown{color:#6b6f80;font-style:italic}td.conflict{background:#fff4e5}.cite{color:var(--ultra);text-decoration:none;font-size:11px;vertical-align:super}
.mh{padding:0 6px;border-radius:2px;font-size:12px}.mh.pass{background:#e8f7c2}.mh.fail{background:#ffe0e0}.mh.unknown{background:var(--mist)}
.note{background:var(--mist);padding:8px 10px;border-left:3px solid var(--ultra)}.decision dl{display:grid;grid-template-columns:140px 1fr;gap:4px 12px}.decision dt{font-weight:600}
.evidence li{margin-bottom:4px}footer{margin-top:32px;border-top:1px solid var(--lav);padding-top:12px;font-size:12px;color:#444}
@media print{main{padding:0}a{color:inherit}}
`;
