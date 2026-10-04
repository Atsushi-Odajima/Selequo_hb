// Loads a project into the pure comparison engine and exposes table / missing / conflicts / scenarios.

import { compare, compareScenarios, type CompareInput, type CompareOptions, type ScenarioInput } from '../../shared/compare';
import { toCsv } from '../../shared/textsafety';
import type { Attribute, Candidate, Criterion, PriceSnapshot, Scenario } from '../../shared/types';
import { getProjectRow, mapRows, type Ctx } from './core';
import { listFacts, listPrices } from './facts';
import { listAttributes, listCandidates, listCriteria, listScenarios } from './projects';

export async function loadCompareInput(ctx: Ctx, projectId: string): Promise<{ input: CompareInput; project: Record<string, any>; scenarios: Scenario[] }> {
  const project = await getProjectRow(ctx, projectId);
  const [candidates, attributes, facts, criteria, prices, scenarios] = await Promise.all([
    listCandidates(ctx, projectId),
    listAttributes(ctx, projectId),
    listFacts(ctx, projectId),
    listCriteria(ctx, projectId),
    listPrices(ctx, projectId),
    listScenarios(ctx, projectId),
  ]);
  const sources = mapRows<CompareInput['sources'][number]>(
    await ctx.db.query(`SELECT id, quality, retrieved_at, captured_at, type, status, title, url FROM sources WHERE project_id = $1 AND workspace_id = $2`, [projectId, ctx.workspaceId]),
  );
  return {
    input: {
      candidates: candidates as Candidate[],
      attributes: attributes as Attribute[],
      facts,
      criteria: criteria.map((c) => ({ ...c, weight: Number(c.weight) })) as Criterion[],
      prices: prices as PriceSnapshot[],
      sources,
    },
    project,
    scenarios,
  };
}

export function optionsFor(project: Record<string, any>, extra: Partial<CompareOptions> = {}): CompareOptions {
  const dp = (project.default_params ?? {}) as Record<string, any>;
  return { factPolicy: project.fact_policy, currency: project.currency, seats: dp.seats ?? null, costBasis: dp.costBasis, includeShipping: dp.includeShipping, ...extra };
}

export const toScenarioInput = (s: Scenario): ScenarioInput => ({ id: s.id, name: s.name, weights: s.weights, mustHaves: s.mustHaves, params: s.params });

export async function getCompare(ctx: Ctx, projectId: string, opts: { scenarioId?: string | null; factPolicy?: CompareOptions['factPolicy'] } = {}) {
  const { input, project, scenarios } = await loadCompareInput(ctx, projectId);
  const scenario = opts.scenarioId ? scenarios.find((s) => s.id === opts.scenarioId) : null;
  const result = compare(input, scenario ? toScenarioInput(scenario) : null, optionsFor(project, opts.factPolicy ? { factPolicy: opts.factPolicy } : {}));
  return { ...result, candidates: input.candidates, scenarios: scenarios.map((s) => ({ id: s.id, name: s.name })) };
}

export async function getScenarioMatrix(ctx: Ctx, projectId: string) {
  const { input, project, scenarios } = await loadCompareInput(ctx, projectId);
  const list: ScenarioInput[] = [{ id: null, name: '既定（基本Weight）' }, ...scenarios.map(toScenarioInput)];
  return { ...compareScenarios(input, list, optionsFor(project)), candidates: input.candidates.map((c) => ({ id: c.id, name: c.name })) };
}

/** Missing-information queue: unknown cells + open questions; Unknown is never treated as zero. */
export async function getMissing(ctx: Ctx, projectId: string) {
  const r = await getCompare(ctx, projectId);
  const candName = new Map(r.candidates.map((c) => [c.id, c.name]));
  const attrName = new Map(r.rows.map((row) => [row.attributeKey, row.displayName]));
  const crits = await listCriteria(ctx, projectId);
  const mustHaveAttrs = new Set(crits.filter((c) => c.mustHave && c.status === 'active').flatMap((c) => c.linkedAttributes));
  const questions = await ctx.db.query(`SELECT * FROM questions WHERE project_id = $1 AND workspace_id = $2 AND status = 'open'`, [projectId, ctx.workspaceId]);
  const mustHaveUnknown = r.criteria
    .filter((c) => c.mustHave)
    .flatMap((c) => c.perCandidate.filter((p) => p.mustHave === 'unknown').map((p) => ({ criterionId: c.criterionId, criterion: c.name, candidateId: p.candidateId, candidate: candName.get(p.candidateId), reason: p.reason })));
  return {
    missing: r.missing.map((m) => ({ ...m, candidate: candName.get(m.candidateId), attribute: attrName.get(m.attributeKey), mustHave: mustHaveAttrs.has(m.attributeKey) })),
    conflicts: r.conflicts.map((c) => ({ ...c, candidate: candName.get(c.candidateId), attribute: attrName.get(c.attributeKey) })),
    mustHaveUnknown,
    openQuestions: questions.length,
    unconfirmedCells: r.rows.flatMap((row) => row.cells.filter((c) => c.status === 'value' && !c.verified).map((c) => ({ candidateId: c.candidateId, attributeKey: row.attributeKey, candidate: candName.get(c.candidateId), attribute: row.displayName }))),
  };
}

export async function compareCsv(ctx: Ctx, projectId: string) {
  const r = await getCompare(ctx, projectId);
  const header = ['項目', ...r.candidates.map((c) => c.name)];
  const rows: unknown[][] = [header];
  for (const row of r.rows) rows.push([row.displayName, ...row.cells.map((c) => (c.status === 'unknown' ? 'Unknown' : c.status === 'conflict' ? `Conflict: ${c.values.map((v) => v.display).join(' / ')}` : c.display + (c.verified ? '' : ' (未確認)')))]);
  rows.push([]);
  rows.push(['スコア（このCriteria設定での参考値）', ...r.candidates.map((c) => r.scores.find((s) => s.candidateId === c.id)?.score ?? 'N/A')]);
  rows.push(['カバー率', ...r.candidates.map((c) => `${Math.round((r.scores.find((s) => s.candidateId === c.id)?.coverage ?? 0) * 100)}%`)]);
  return toCsv(rows);
}

