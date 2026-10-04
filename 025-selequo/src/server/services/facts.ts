// Facts: review (Confirm/Reject/Supersede), conflicts, manual & screenshot-region facts, evidence, price snapshots.

import { z } from 'zod';
import { CATALOG_BY_KEY } from '../../shared/attributes';
import { normalizeValue, shapeFor } from '../../shared/normalize';
import { isOpinion } from '../../shared/textsafety';
import type { Fact, PriceSnapshot, SourceRange } from '../../shared/types';
import { newId } from '../auth/crypto';
import { signFileUrl } from '../storage';
import { assertInProject, audit, badRequest, getProjectRow, mapRow, mapRows, need, notFound, type Ctx } from './core';
import { insertFact, manualSource } from './sources';

export function mapFact(row: Record<string, unknown>): Fact {
  return mapRow<Fact>(row);
}

export async function listFacts(ctx: Ctx, projectId: string, filter: { candidateId?: string; attributeKey?: string; state?: string; kind?: string; sourceId?: string } = {}) {
  await getProjectRow(ctx, projectId);
  const params: unknown[] = [projectId, ctx.workspaceId];
  let where = 'f.project_id = $1 AND f.workspace_id = $2';
  for (const [col, v] of [
    ['f.candidate_id', filter.candidateId],
    ['f.attribute_key', filter.attributeKey],
    ['f.review_state', filter.state],
    ['f.kind', filter.kind],
    ['f.source_id', filter.sourceId],
  ] as const) {
    if (!v) continue;
    params.push(v);
    where += ` AND ${col} = $${params.length}`;
  }
  const rows = await ctx.db.query(
    `SELECT f.*, s.type AS source_type, s.title AS source_title, s.url AS source_url, s.quality AS source_quality, s.retrieved_at AS source_retrieved_at, s.captured_at AS source_captured_at
       FROM facts f JOIN sources s ON s.id = f.source_id WHERE ${where} AND s.status <> 'deleted' ORDER BY f.created_at`,
    params,
  );
  return rows.map((r) => mapFact(r));
}

export async function getEvidence(ctx: Ctx, factId: string) {
  const row = await assertInProject(ctx, 'facts', factId);
  const fact = mapFact(row);
  const src = await ctx.db.one(`SELECT s.*, u.name AS created_by_name FROM sources s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = $1`, [fact.sourceId]);
  if (!src) throw notFound('ソース');
  const source = mapRow<Record<string, any>>(src) as Record<string, any>;
  delete source.extractedText;
  delete source.pages;
  const siblings = fact.attributeKey
    ? (await ctx.db.query(`SELECT f.*, s.title AS source_title, s.quality AS source_quality FROM facts f JOIN sources s ON s.id = f.source_id WHERE f.candidate_id = $1 AND f.attribute_key = $2 AND f.id <> $3 AND s.status <> 'deleted' ORDER BY f.created_at`, [fact.candidateId, fact.attributeKey, fact.id])).map(mapFact)
    : [];
  const comments = mapRows(await ctx.db.query(`SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.entity_type = 'fact' AND c.entity_id = $1 AND c.workspace_id = $2 ORDER BY c.created_at`, [factId, ctx.workspaceId]));
  const history = mapRows(await ctx.db.query(`SELECT action, actor_type, actor_id, detail, created_at FROM audit_log WHERE workspace_id = $1 AND entity_type = 'fact' AND entity_id = $2 ORDER BY created_at`, [ctx.workspaceId, factId]));
  const reviewer = row.reviewed_by ? await ctx.db.one<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [row.reviewed_by]) : null;
  // original context: surrounding text (PDF page / text window); never more than ~1200 chars
  let originalContext: string | null = null;
  const r = fact.sourceRange as SourceRange;
  if (src.status !== 'deleted' && (r.type === 'text' || r.type === 'pdf')) {
    const text: string = r.type === 'pdf' ? (src.pages?.[r.page - 1] ?? '') : (src.extracted_text ?? '');
    if (r.end > r.start) originalContext = text.slice(Math.max(0, r.start - 400), Math.min(text.length, r.end + 400));
    else originalContext = r.context;
  }
  const conflicting = siblings.filter((s) => (s.reviewState === 'confirmed' || s.reviewState === 'candidate') && s.kind === 'fact' && JSON.stringify(s.normalizedValue) !== JSON.stringify(fact.normalizedValue));
  return {
    fact,
    source: { ...source, fileUrl: src.file_key ? signFileUrl(ctx.config.secret, src.file_key) : null },
    originalContext,
    siblings,
    conflict: conflicting.length > 0 && fact.kind === 'fact' && ['candidate', 'confirmed'].includes(fact.reviewState),
    comments,
    history,
    reviewedByName: reviewer?.name ?? null,
  };
}

export const ReviewInput = z.object({ action: z.enum(['confirm', 'reject', 'reopen']), note: z.string().max(2000).nullish() });

export async function reviewFact(ctx: Ctx, factId: string, input: z.infer<typeof ReviewInput>) {
  need(ctx, 'reviewer');
  const row = await assertInProject(ctx, 'facts', factId);
  const src = await ctx.db.one(`SELECT status, type, created_by FROM sources WHERE id = $1`, [row.source_id]);
  if (input.action === 'confirm') {
    // A fact without a live source can never be confirmed
    if (!src || src.status === 'deleted') throw badRequest('出典（Source）のないFactはConfirmedにできません');
    if (src.type === 'manual' && !src.created_by) throw badRequest('入力者が記録されていない手入力はConfirmedにできません');
    if (row.kind === 'opinion') throw badRequest('Opinion（意見）はFactとしてConfirmedにできません。Factに変更する場合は種類を修正してください');
  }
  const state = input.action === 'confirm' ? 'confirmed' : input.action === 'reject' ? 'rejected' : 'candidate';
  await ctx.db.query(`UPDATE facts SET review_state = $2, reviewed_by = $3, reviewed_at = now(), note = COALESCE($4, note), superseded_by = CASE WHEN $2 = 'candidate' THEN NULL ELSE superseded_by END WHERE id = $1`, [
    factId,
    state,
    ctx.actor.userId,
    input.note ?? null,
  ]);
  await audit(ctx, `fact.${input.action}`, { type: 'fact', id: factId, projectId: row.project_id }, { from: row.review_state, to: state, note: input.note ?? undefined });
  return mapFact((await ctx.db.one(`SELECT * FROM facts WHERE id = $1`, [factId]))!);
}

export async function bulkReview(ctx: Ctx, projectId: string, factIds: string[], action: 'confirm' | 'reject') {
  need(ctx, 'reviewer');
  await getProjectRow(ctx, projectId);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of factIds.slice(0, 500)) {
    try {
      await reviewFact(ctx, id, { action });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

/** Resolve a conflict: keep one fact (confirmed), the others become superseded (kept, never deleted). */
export async function resolveConflict(ctx: Ctx, projectId: string, input: { keepFactId: string; supersedeFactIds: string[]; note?: string | null }) {
  need(ctx, 'reviewer');
  const keep = await assertInProject(ctx, 'facts', input.keepFactId, projectId);
  for (const id of input.supersedeFactIds) {
    const f = await assertInProject(ctx, 'facts', id, projectId);
    if (f.candidate_id !== keep.candidate_id || f.attribute_key !== keep.attribute_key) throw badRequest('同じ候補・同じ属性のFactのみ解決できます');
  }
  await reviewFact(ctx, input.keepFactId, { action: 'confirm', note: input.note });
  for (const id of input.supersedeFactIds) {
    await ctx.db.query(`UPDATE facts SET review_state = 'superseded', superseded_by = $2, reviewed_by = $3, reviewed_at = now(), note = COALESCE($4, note) WHERE id = $1`, [id, input.keepFactId, ctx.actor.userId, input.note ?? null]);
    await audit(ctx, 'fact.supersede', { type: 'fact', id, projectId }, { by: input.keepFactId, note: input.note ?? undefined });
  }
  await audit(ctx, 'conflict.resolve', { type: 'fact', id: input.keepFactId, projectId }, { superseded: input.supersedeFactIds });
}

export const FactPatch = z.object({ attributeKey: z.string().max(48).nullish(), kind: z.enum(['fact', 'opinion']).optional(), note: z.string().max(2000).nullish() });

/** Re-map a fact to another attribute or switch fact/opinion (never edits the raw value or source). */
export async function patchFact(ctx: Ctx, factId: string, input: z.infer<typeof FactPatch>) {
  need(ctx, 'editor');
  const row = await assertInProject(ctx, 'facts', factId);
  let normalized = row.normalized_value;
  let issue = row.issue;
  let key = row.attribute_key;
  if (input.attributeKey !== undefined && input.attributeKey !== row.attribute_key) {
    key = input.attributeKey;
    if (key) {
      const attr = await ctx.db.one(`SELECT type, unit FROM attributes WHERE project_id = $1 AND key = $2`, [row.project_id, key]);
      if (!attr && !CATALOG_BY_KEY.has(key)) throw notFound('属性');
      const r = normalizeValue(shapeFor(key, attr ? { type: attr.type, unit: attr.unit } : undefined), row.raw_value);
      normalized = r.value;
      issue = r.issue;
    } else {
      normalized = null;
      issue = null;
    }
  }
  await ctx.db.query(`UPDATE facts SET attribute_key = $2, normalized_value = $3, unit = $4, issue = $5, kind = $6, note = COALESCE($7, note), review_state = CASE WHEN $8 THEN 'candidate' ELSE review_state END WHERE id = $1`, [
    factId,
    key,
    normalized ? JSON.stringify(normalized) : null,
    normalized?.kind === 'number' ? normalized.unit : null,
    issue,
    input.kind ?? row.kind,
    input.note ?? null,
    key !== row.attribute_key || (input.kind !== undefined && input.kind !== row.kind), // re-review after mapping changes
  ]);
  await audit(ctx, 'fact.update', { type: 'fact', id: factId, projectId: row.project_id }, { attributeKey: key !== row.attribute_key ? { from: row.attribute_key, to: key } : undefined, kind: input.kind });
  return mapFact((await ctx.db.one(`SELECT * FROM facts WHERE id = $1`, [factId]))!);
}

export const ManualFactInput = z.object({
  candidateId: z.string(),
  attributeKey: z.string().max(48).nullish(),
  label: z.string().trim().max(200).nullish(),
  value: z.string().trim().min(1).max(1000),
  note: z.string().max(2000).nullish(),
  // screenshot / image evidence: cite a region of an uploaded image
  sourceId: z.string().nullish(),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }).nullish(),
  page: z.number().int().positive().nullish(),
});

export async function addManualFact(ctx: Ctx, projectId: string, input: z.infer<typeof ManualFactInput>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  await assertInProject(ctx, 'candidates', input.candidateId, projectId);
  let sourceId: string;
  let range: SourceRange;
  let extractedBy = 'manual';
  if (input.sourceId) {
    const src = await assertInProject(ctx, 'sources', input.sourceId, projectId);
    if (src.status === 'deleted') throw badRequest('削除済みのソースです');
    sourceId = src.id;
    if (src.type === 'screenshot' || src.type === 'image') range = { type: 'image', region: input.region ?? null, context: `${input.label ?? input.attributeKey ?? ''}: ${input.value}` };
    else if (src.type === 'pdf') range = { type: 'pdf', page: input.page ?? 1, start: 0, end: 0, context: input.value };
    else range = { type: 'manual', by: ctx.actor.name, context: input.value };
    extractedBy = 'manual:transcribed';
    if (!src.candidate_id) await ctx.db.query(`UPDATE sources SET candidate_id = $2 WHERE id = $1`, [src.id, input.candidateId]);
  } else {
    sourceId = await manualSource(ctx, projectId, input.candidateId);
    range = { type: 'manual', by: ctx.actor.name, context: input.value };
  }
  const key = input.attributeKey ?? null;
  let normalized = null;
  let issue = null;
  if (key) {
    const attr = await ctx.db.one(`SELECT type, unit FROM attributes WHERE project_id = $1 AND key = $2`, [projectId, key]);
    const r = normalizeValue(shapeFor(key, attr ? { type: attr.type, unit: attr.unit } : undefined), input.value);
    normalized = r.value;
    issue = r.issue;
  }
  const attrName = key ? ((await ctx.db.one<{ display_name: string }>(`SELECT display_name FROM attributes WHERE project_id = $1 AND key = $2`, [projectId, key]))?.display_name ?? key) : null;
  const id = await insertFact(ctx, {
    projectId,
    candidateId: input.candidateId,
    sourceId,
    fact: {
      rawLabel: input.label || attrName || 'メモ',
      rawValue: input.value,
      attributeKey: key,
      ambiguous: [],
      normalizedValue: normalized,
      unit: normalized?.kind === 'number' ? normalized.unit : null,
      issue,
      kind: isOpinion(input.value) ? 'opinion' : 'fact',
      sourceRange: range,
      confidence: 1,
    },
    extractedBy,
  });
  if (input.note) await ctx.db.query(`UPDATE facts SET note = $2 WHERE id = $1`, [id, input.note]);
  await audit(ctx, 'fact.create_manual', { type: 'fact', id, projectId }, { attributeKey: key, sourceId });
  return mapFact((await ctx.db.one(`SELECT * FROM facts WHERE id = $1`, [id]))!);
}

// ---------------- price snapshots

export const PriceInput = z.object({
  candidateId: z.string(),
  sourceId: z.string().nullish(),
  amount: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  tax: z.enum(['included', 'excluded', 'unknown']).default('unknown'),
  shipping: z.number().nonnegative().nullish(),
  billingPeriod: z.enum(['one_time', 'monthly', 'annual', 'unknown']).default('one_time'),
  contractMonths: z.number().int().positive().nullish(),
  perSeat: z.boolean().default(false),
  seats: z.number().int().positive().nullish(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  fxRate: z.number().positive().nullish(),
  fxBase: z.string().regex(/^[A-Z]{3}$/).nullish(),
  fxSource: z.string().max(200).nullish(),
  fxAt: z.string().datetime({ offset: true }).nullish(),
  note: z.string().max(500).nullish(),
});

export async function listPrices(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows<PriceSnapshot>(
    await ctx.db.query(`SELECT p.* FROM price_snapshots p LEFT JOIN sources s ON s.id = p.source_id WHERE p.project_id = $1 AND p.workspace_id = $2 AND (s.id IS NULL OR s.status <> 'deleted') ORDER BY p.captured_at DESC`, [projectId, ctx.workspaceId]),
  );
}

export async function addPrice(ctx: Ctx, projectId: string, input: z.input<typeof PriceInput>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  const p = PriceInput.parse(input);
  await assertInProject(ctx, 'candidates', p.candidateId, projectId);
  if (p.sourceId) await assertInProject(ctx, 'sources', p.sourceId, projectId);
  if (p.fxRate && (!p.fxSource || !p.fxAt || !p.fxBase)) throw badRequest('為替レートには出典（fxSource）・時点（fxAt）・換算先通貨（fxBase）が必要です');
  const sourceId = p.sourceId ?? (await manualSource(ctx, projectId, p.candidateId));
  const id = newId();
  await ctx.db.query(
    `INSERT INTO price_snapshots (id, workspace_id, project_id, candidate_id, source_id, amount, currency, tax, shipping, billing_period, contract_months, per_seat, seats, captured_at, fx_rate, fx_base, fx_source, fx_at, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [id, ctx.workspaceId, projectId, p.candidateId, sourceId, p.amount, p.currency, p.tax, p.shipping ?? null, p.billingPeriod, p.contractMonths ?? null, p.perSeat, p.seats ?? null, p.capturedAt ?? new Date().toISOString(), p.fxRate ?? null, p.fxBase ?? null, p.fxSource ?? null, p.fxAt ?? null, p.note ?? null, ctx.actor.userId],
  );
  await audit(ctx, 'price.add', { type: 'price_snapshot', id, projectId }, { amount: p.amount, currency: p.currency, billingPeriod: p.billingPeriod });
  return mapRow<PriceSnapshot>((await ctx.db.one(`SELECT * FROM price_snapshots WHERE id = $1`, [id]))!);
}

export async function updatePriceFx(ctx: Ctx, id: string, input: { fxRate: number; fxBase: string; fxSource: string; fxAt: string }) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'price_snapshots', id);
  await ctx.db.query(`UPDATE price_snapshots SET fx_rate = $2, fx_base = $3, fx_source = $4, fx_at = $5 WHERE id = $1`, [id, input.fxRate, input.fxBase, input.fxSource, input.fxAt]);
  await audit(ctx, 'price.fx', { type: 'price_snapshot', id, projectId: cur.project_id }, input);
}

