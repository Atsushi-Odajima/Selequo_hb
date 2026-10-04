// Projects, candidates, attributes (dynamic schema), criteria, scenarios, questions, notes, comments.

import { z } from 'zod';
import { CATALOG, CATALOG_BY_KEY, slugKey } from '../../shared/attributes';
import { normalizeValue, shapeFor } from '../../shared/normalize';
import { validateWeights } from '../../shared/compare';
import { CANDIDATE_STATUSES, PROJECT_STATUSES } from '../../shared/types';
import type { Attribute, Candidate, Criterion, Project, Question, Scenario } from '../../shared/types';
import { newId } from '../auth/crypto';
import { assertInProject, audit, badRequest, getProjectRow, mapRow, mapRows, need, notFound, type Ctx } from './core';
import { indexEntity, unindexEntity } from './search';

// ---------------- projects

export const ProjectInput = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).nullish(),
  purpose: z.string().trim().max(2000).nullish(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status: z.enum(PROJECT_STATUSES).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  locale: z.string().max(10).optional(),
  aiEnabled: z.boolean().optional(),
  factPolicy: z.enum(['confirmed_only', 'include_unreviewed']).optional(),
  defaultParams: z.object({ seats: z.number().int().positive().nullish(), costBasis: z.enum(['as_listed', 'annual_total', 'monthly_equivalent']).optional(), includeShipping: z.boolean().optional() }).optional(),
});

export const DEFAULT_ATTRS: Record<string, string[]> = {
  laptop: ['price', 'cpu', 'memory', 'storage', 'display_size', 'weight', 'battery_life', 'os', 'warranty'],
  saas: ['price', 'seat_limit', 'sla', 'sso', 'certifications', 'integrations', 'support', 'contract_term'],
  default: ['price', 'warranty', 'support', 'delivery'],
};

export async function createProject(ctx: Ctx, input: z.infer<typeof ProjectInput>) {
  need(ctx, 'editor');
  const id = newId();
  await ctx.db.tx(async (db) => {
    await db.query(
      `INSERT INTO projects (id, workspace_id, title, category, purpose, deadline, status, currency, locale, ai_enabled, fact_policy, default_params, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, ctx.workspaceId, input.title, input.category ?? null, input.purpose ?? null, input.deadline ?? null, input.status ?? 'active', input.currency ?? 'JPY', input.locale ?? 'ja-JP', input.aiEnabled ?? true, input.factPolicy ?? 'confirmed_only', JSON.stringify(input.defaultParams ?? {}), ctx.actor.userId],
    );
    const keys = DEFAULT_ATTRS[input.category ?? ''] ?? DEFAULT_ATTRS.default;
    let order = 0;
    for (const key of keys) {
      const c = CATALOG_BY_KEY.get(key)!;
      await db.query(
        `INSERT INTO attributes (id, workspace_id, project_id, key, display_name, type, unit, category, aliases, sort_order, origin, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'catalog','active')`,
        [newId(), ctx.workspaceId, id, key, c.displayName, c.type, c.unit ?? null, c.category, c.aliases, (order += 10)],
      );
    }
  });
  await indexEntity(ctx.db, ctx.workspaceId, 'project', id, id, input.title, `${input.purpose ?? ''} ${input.category ?? ''}`);
  await audit(ctx, 'project.create', { type: 'project', id, projectId: id }, { title: input.title });
  return getProject(ctx, id);
}

export async function listProjects(ctx: Ctx) {
  const rows = await ctx.db.query(
    `SELECT p.*, (SELECT count(*)::int FROM candidates c WHERE c.project_id = p.id) AS candidate_count,
            (SELECT count(*)::int FROM sources s WHERE s.project_id = p.id AND s.status <> 'deleted') AS source_count
       FROM projects p WHERE p.workspace_id = $1 ORDER BY p.updated_at DESC`,
    [ctx.workspaceId],
  );
  return mapRows<Project & { candidateCount: number; sourceCount: number }>(rows);
}

export async function getProject(ctx: Ctx, id: string) {
  return mapRow<Project & { factPolicy: string; defaultParams: Record<string, unknown> }>(await getProjectRow(ctx, id));
}

export async function updateProject(ctx: Ctx, id: string, input: Partial<z.infer<typeof ProjectInput>>) {
  need(ctx, 'editor');
  const cur = await getProjectRow(ctx, id);
  const next = {
    title: input.title ?? cur.title,
    category: input.category !== undefined ? input.category : cur.category,
    purpose: input.purpose !== undefined ? input.purpose : cur.purpose,
    deadline: input.deadline !== undefined ? input.deadline : cur.deadline,
    status: input.status ?? cur.status,
    currency: input.currency ?? cur.currency,
    locale: input.locale ?? cur.locale,
    ai_enabled: input.aiEnabled ?? cur.ai_enabled,
    fact_policy: input.factPolicy ?? cur.fact_policy,
    default_params: input.defaultParams ?? cur.default_params,
  };
  await ctx.db.query(
    `UPDATE projects SET title=$3, category=$4, purpose=$5, deadline=$6, status=$7, currency=$8, locale=$9, ai_enabled=$10, fact_policy=$11, default_params=$12, updated_at=now() WHERE id=$1 AND workspace_id=$2`,
    [id, ctx.workspaceId, next.title, next.category, next.purpose, next.deadline, next.status, next.currency, next.locale, next.ai_enabled, next.fact_policy, JSON.stringify(next.default_params)],
  );
  await indexEntity(ctx.db, ctx.workspaceId, 'project', id, id, next.title, `${next.purpose ?? ''} ${next.category ?? ''}`);
  await audit(ctx, input.aiEnabled !== undefined && input.aiEnabled !== cur.ai_enabled ? 'project.ai_toggle' : 'project.update', { type: 'project', id, projectId: id }, input);
  return getProject(ctx, id);
}

export async function deleteProject(ctx: Ctx, id: string) {
  need(ctx, 'admin');
  await getProjectRow(ctx, id);
  const files = await ctx.db.query<{ file_key: string }>(`SELECT file_key FROM sources WHERE project_id = $1 AND file_key IS NOT NULL`, [id]);
  for (const f of files) await ctx.storage.delete(f.file_key);
  await ctx.db.query(`DELETE FROM search_index WHERE project_id = $1 AND workspace_id = $2`, [id, ctx.workspaceId]);
  await ctx.db.query(`DELETE FROM projects WHERE id = $1 AND workspace_id = $2`, [id, ctx.workspaceId]);
  await audit(ctx, 'project.delete', { type: 'project', id, projectId: id });
}

export const touch = (ctx: Ctx, projectId: string) => ctx.db.query(`UPDATE projects SET updated_at = now() WHERE id = $1`, [projectId]);

// ---------------- candidates

export const CandidateInput = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.string().trim().max(120).nullish(),
  url: z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'http/https のURLのみ').nullish().or(z.literal('')),
  notes: z.string().max(5000).nullish(),
  tags: z.array(z.string().trim().max(30)).max(20).optional(),
  status: z.enum(CANDIDATE_STATUSES).optional(),
});

export async function listCandidates(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows<Candidate>(await ctx.db.query(`SELECT * FROM candidates WHERE project_id = $1 AND workspace_id = $2 ORDER BY sort_order, created_at`, [projectId, ctx.workspaceId]));
}

export async function createCandidate(ctx: Ctx, projectId: string, input: z.infer<typeof CandidateInput>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  const id = newId();
  const n = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM candidates WHERE project_id = $1`, [projectId]);
  // status 'chosen'/'rejected' are human decisions; on creation a candidate is always 'considering'
  await ctx.db.query(`INSERT INTO candidates (id, workspace_id, project_id, name, provider, url, notes, tags, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    id,
    ctx.workspaceId,
    projectId,
    input.name,
    input.provider ?? null,
    input.url || null,
    input.notes ?? null,
    input.tags ?? [],
    (n?.n ?? 0) * 10,
  ]);
  await indexEntity(ctx.db, ctx.workspaceId, 'candidate', id, projectId, input.name, `${input.provider ?? ''} ${input.notes ?? ''} ${(input.tags ?? []).join(' ')}`);
  await audit(ctx, 'candidate.create', { type: 'candidate', id, projectId }, { name: input.name });
  await touch(ctx, projectId);
  return mapRow<Candidate>((await ctx.db.one(`SELECT * FROM candidates WHERE id = $1`, [id]))!);
}

export async function updateCandidate(ctx: Ctx, id: string, input: Partial<z.infer<typeof CandidateInput>>) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'candidates', id);
  if (input.status && input.status !== cur.status && (input.status === 'chosen' || cur.status === 'chosen') && ctx.actor.type !== 'user') {
    // MCP/API tokens can never set the chosen state — decisions are made by a person in the UI
    throw badRequest('Chosen の設定は画面から人が行ってください（自動決定は禁止）');
  }
  const next = { ...mapRow<Candidate>(cur), ...input };
  await ctx.db.query(`UPDATE candidates SET name=$2, provider=$3, url=$4, notes=$5, tags=$6, status=$7, updated_at=now() WHERE id=$1`, [
    id,
    next.name,
    next.provider ?? null,
    next.url || null,
    next.notes ?? null,
    next.tags ?? [],
    next.status,
  ]);
  await indexEntity(ctx.db, ctx.workspaceId, 'candidate', id, cur.project_id, next.name, `${next.provider ?? ''} ${next.notes ?? ''} ${(next.tags ?? []).join(' ')}`);
  await audit(ctx, input.status && input.status !== cur.status ? 'candidate.status' : 'candidate.update', { type: 'candidate', id, projectId: cur.project_id }, input);
  return mapRow<Candidate>((await ctx.db.one(`SELECT * FROM candidates WHERE id = $1`, [id]))!);
}

export async function deleteCandidate(ctx: Ctx, id: string) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'candidates', id);
  const facts = await ctx.db.query<{ id: string }>(`SELECT id FROM facts WHERE candidate_id = $1`, [id]);
  for (const f of facts) await unindexEntity(ctx.db, ctx.workspaceId, 'fact', f.id);
  await ctx.db.query(`DELETE FROM candidates WHERE id = $1`, [id]);
  await unindexEntity(ctx.db, ctx.workspaceId, 'candidate', id);
  await audit(ctx, 'candidate.delete', { type: 'candidate', id, projectId: cur.project_id }, { name: cur.name });
}

// ---------------- attributes (dynamic schema) & normalization rules

export const AttributeInput = z.object({
  key: z.string().trim().max(48).optional(),
  displayName: z.string().trim().min(1).max(60),
  type: z.enum(['number', 'text', 'bool', 'price']).default('text'),
  unit: z.string().trim().max(20).nullish(),
  category: z.string().trim().max(30).default('general'),
  aliases: z.array(z.string().trim().max(60)).max(30).default([]),
  groupName: z.string().trim().max(40).nullish(),
  status: z.enum(['active', 'suggested', 'removed']).optional(),
  sortOrder: z.number().int().optional(),
});

export async function listAttributes(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows<Attribute>(await ctx.db.query(`SELECT * FROM attributes WHERE project_id = $1 AND workspace_id = $2 ORDER BY sort_order, key`, [projectId, ctx.workspaceId]));
}

export async function createAttribute(ctx: Ctx, projectId: string, input: z.input<typeof AttributeInput>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  const parsed = AttributeInput.parse(input);
  const key = parsed.key || slugKey(parsed.displayName);
  const cat = CATALOG_BY_KEY.get(key);
  const exists = await ctx.db.one(`SELECT id, status FROM attributes WHERE project_id = $1 AND key = $2 AND workspace_id = $3`, [projectId, key, ctx.workspaceId]);
  if (exists) {
    await ctx.db.query(`UPDATE attributes SET status = $2, display_name = $3, group_name = COALESCE($4, group_name) WHERE id = $1`, [exists.id, parsed.status ?? 'active', parsed.displayName, parsed.groupName ?? null]);
  } else {
    const max = await ctx.db.one<{ m: number }>(`SELECT COALESCE(max(sort_order),0)::int AS m FROM attributes WHERE project_id = $1`, [projectId]);
    await ctx.db.query(
      `INSERT INTO attributes (id, workspace_id, project_id, key, display_name, type, unit, category, aliases, group_name, sort_order, origin, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [newId(), ctx.workspaceId, projectId, key, parsed.displayName, cat?.type ?? parsed.type, cat?.unit ?? parsed.unit ?? null, cat?.category ?? parsed.category, [...new Set([...(cat?.aliases ?? []), ...parsed.aliases])], parsed.groupName ?? null, parsed.sortOrder ?? (max?.m ?? 0) + 10, cat ? 'catalog' : 'user', parsed.status ?? 'active'],
    );
  }
  await audit(ctx, 'attribute.add', { type: 'attribute', id: key, projectId }, { displayName: parsed.displayName });
  return mapRow<Attribute>((await ctx.db.one(`SELECT * FROM attributes WHERE project_id = $1 AND key = $2`, [projectId, key]))!);
}

export async function updateAttribute(ctx: Ctx, id: string, input: Partial<z.input<typeof AttributeInput>>) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'attributes', id);
  await ctx.db.query(`UPDATE attributes SET display_name = $2, group_name = $3, status = $4, sort_order = $5, aliases = $6 WHERE id = $1`, [
    id,
    input.displayName ?? cur.display_name,
    input.groupName !== undefined ? input.groupName : cur.group_name,
    input.status ?? cur.status,
    input.sortOrder ?? cur.sort_order,
    input.aliases ?? cur.aliases,
  ]);
  const action = input.status === 'removed' ? 'attribute.remove' : input.displayName && input.displayName !== cur.display_name ? 'attribute.rename' : input.groupName !== undefined ? 'attribute.group' : 'attribute.update';
  await audit(ctx, action, { type: 'attribute', id: cur.key, projectId: cur.project_id }, input);
  return mapRow<Attribute>((await ctx.db.one(`SELECT * FROM attributes WHERE id = $1`, [id]))!);
}

/** Attribute suggestions = unmapped fact labels + catalog attributes with facts that are not active yet. AI never decides importance. */
export async function attributeSuggestions(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  const unmapped = await ctx.db.query<{ raw_label: string; n: number; ambiguous: string | null }>(
    `SELECT raw_label, count(*)::int AS n, max(issue) AS ambiguous FROM facts WHERE project_id = $1 AND workspace_id = $2 AND attribute_key IS NULL AND kind = 'fact' AND review_state <> 'rejected' GROUP BY raw_label ORDER BY n DESC LIMIT 50`,
    [projectId, ctx.workspaceId],
  );
  const mappedInactive = await ctx.db.query<{ attribute_key: string; n: number }>(
    `SELECT f.attribute_key, count(*)::int AS n FROM facts f WHERE f.project_id = $1 AND f.workspace_id = $2 AND f.attribute_key IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM attributes a WHERE a.project_id = f.project_id AND a.key = f.attribute_key AND a.status = 'active')
     GROUP BY f.attribute_key`,
    [projectId, ctx.workspaceId],
  );
  return {
    unmappedLabels: unmapped.map((u) => ({ label: u.raw_label, count: u.n })),
    catalogCandidates: mappedInactive.map((m) => ({ key: m.attribute_key, displayName: CATALOG_BY_KEY.get(m.attribute_key)?.displayName ?? m.attribute_key, count: m.n })),
    catalog: CATALOG.map((c) => ({ key: c.key, displayName: c.displayName, type: c.type, unit: c.unit ?? null })),
  };
}

/**
 * Map a raw label to an attribute (creates a versioned normalization rule) and re-normalize matching facts.
 * Rule history is kept (older versions deactivated, never deleted).
 */
export async function mapLabel(ctx: Ctx, projectId: string, label: string, attributeKey: string) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  const attr = await ctx.db.one(`SELECT * FROM attributes WHERE project_id = $1 AND key = $2 AND workspace_id = $3`, [projectId, attributeKey, ctx.workspaceId]);
  if (!attr) throw notFound('属性');
  const prev = await ctx.db.one<{ version: number }>(`SELECT max(version) AS version FROM normalization_rules WHERE project_id = $1 AND pattern = $2`, [projectId, label]);
  await ctx.db.query(`UPDATE normalization_rules SET active = false WHERE project_id = $1 AND pattern = $2`, [projectId, label]);
  const ruleId = newId();
  await ctx.db.query(`INSERT INTO normalization_rules (id, workspace_id, project_id, kind, pattern, attribute_key, version, created_by) VALUES ($1,$2,$3,'alias',$4,$5,$6,$7)`, [
    ruleId,
    ctx.workspaceId,
    projectId,
    label,
    attributeKey,
    (prev?.version ?? 0) + 1,
    ctx.actor.userId,
  ]);
  const facts = await ctx.db.query<{ id: string; raw_value: string }>(`SELECT id, raw_value FROM facts WHERE project_id = $1 AND raw_label = $2 AND kind = 'fact'`, [projectId, label]);
  let issues = 0;
  for (const f of facts) {
    const r = normalizeValue(shapeFor(attributeKey, { type: attr.type, unit: attr.unit }), f.raw_value);
    if (r.issue) issues++;
    await ctx.db.query(`UPDATE facts SET attribute_key = $2, normalized_value = $3, unit = $4, issue = $5 WHERE id = $1`, [
      f.id,
      attributeKey,
      r.value ? JSON.stringify(r.value) : null,
      r.value?.kind === 'number' ? r.value.unit : null,
      r.issue,
    ]);
  }
  await audit(ctx, 'normalization.rule', { type: 'normalization_rule', id: ruleId, projectId }, { label, attributeKey, version: (prev?.version ?? 0) + 1, facts: facts.length, issues });
  return { ruleId, updatedFacts: facts.length, issues };
}

export async function listRules(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows(await ctx.db.query(`SELECT * FROM normalization_rules WHERE project_id = $1 AND workspace_id = $2 ORDER BY pattern, version DESC`, [projectId, ctx.workspaceId]));
}

// ---------------- criteria

export const CriterionInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).nullish(),
  weight: z.number().min(0).max(100).default(1),
  direction: z.enum(['higher_better', 'lower_better', 'target', 'boolean', 'none']).default('higher_better'),
  mustHave: z.boolean().default(false),
  target: z.object({ op: z.enum(['>=', '<=', '=', '>', '<', 'includes']), value: z.union([z.number(), z.string(), z.boolean()]), unit: z.string().nullish() }).nullish(),
  linkedAttributes: z.array(z.string().max(48)).max(10).default([]),
  status: z.enum(['active', 'suggested']).optional(),
  sortOrder: z.number().int().optional(),
});

export async function listCriteria(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows<Criterion>(await ctx.db.query(`SELECT * FROM criteria WHERE project_id = $1 AND workspace_id = $2 ORDER BY sort_order, created_at`, [projectId, ctx.workspaceId]));
}

export async function createCriterion(ctx: Ctx, projectId: string, input: z.input<typeof CriterionInput>, origin: 'user' | 'suggested' = 'user') {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  const c = CriterionInput.parse(input);
  if (c.mustHave && c.direction !== 'boolean' && !c.target) throw badRequest('Must-have には目標値（target）か boolean 方向が必要です');
  const id = newId();
  const max = await ctx.db.one<{ m: number }>(`SELECT COALESCE(max(sort_order),0)::int AS m FROM criteria WHERE project_id = $1`, [projectId]);
  await ctx.db.query(
    `INSERT INTO criteria (id, workspace_id, project_id, name, description, weight, direction, must_have, target, linked_attributes, origin, status, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, ctx.workspaceId, projectId, c.name, c.description ?? null, c.weight, c.direction, c.mustHave, c.target ? JSON.stringify(c.target) : null, c.linkedAttributes, origin, origin === 'suggested' ? 'suggested' : (c.status ?? 'active'), c.sortOrder ?? (max?.m ?? 0) + 10],
  );
  await audit(ctx, c.mustHave ? 'criterion.create_must_have' : 'criterion.create', { type: 'criterion', id, projectId }, c);
  return mapRow<Criterion>((await ctx.db.one(`SELECT * FROM criteria WHERE id = $1`, [id]))!);
}

export async function updateCriterion(ctx: Ctx, id: string, input: Partial<z.input<typeof CriterionInput>>) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'criteria', id);
  const merged = CriterionInput.parse({ ...mapRow<Criterion>(cur), ...input });
  if (merged.mustHave && merged.direction !== 'boolean' && !merged.target) throw badRequest('Must-have には目標値（target）か boolean 方向が必要です');
  await ctx.db.query(`UPDATE criteria SET name=$2, description=$3, weight=$4, direction=$5, must_have=$6, target=$7, linked_attributes=$8, status=$9, sort_order=$10 WHERE id=$1`, [
    id,
    merged.name,
    merged.description ?? null,
    merged.weight,
    merged.direction,
    merged.mustHave,
    merged.target ? JSON.stringify(merged.target) : null,
    merged.linkedAttributes,
    merged.status ?? cur.status,
    merged.sortOrder ?? cur.sort_order,
  ]);
  const changes: string[] = [];
  if (input.weight !== undefined && Number(cur.weight) !== input.weight) changes.push('criterion.weight');
  if (input.mustHave !== undefined && cur.must_have !== input.mustHave) changes.push('criterion.must_have');
  if (input.status === 'active' && cur.status === 'suggested') changes.push('criterion.accept');
  await audit(ctx, changes[0] ?? 'criterion.update', { type: 'criterion', id, projectId: cur.project_id }, { before: { weight: Number(cur.weight), mustHave: cur.must_have }, after: input });
  return mapRow<Criterion>((await ctx.db.one(`SELECT * FROM criteria WHERE id = $1`, [id]))!);
}

export async function deleteCriterion(ctx: Ctx, id: string) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'criteria', id);
  await ctx.db.query(`DELETE FROM criteria WHERE id = $1`, [id]);
  await audit(ctx, 'criterion.delete', { type: 'criterion', id, projectId: cur.project_id }, { name: cur.name });
}

/** Replace weights in one go (validated). */
export async function setWeights(ctx: Ctx, projectId: string, weights: Record<string, number>) {
  need(ctx, 'editor');
  const errors = validateWeights(Object.values(weights));
  if (errors.length) throw badRequest(errors.join(' / '), { errors });
  const crits = await listCriteria(ctx, projectId);
  for (const [id, w] of Object.entries(weights)) if (!crits.some((c) => c.id === id)) throw notFound('Criteria');
  for (const [id, w] of Object.entries(weights)) await ctx.db.query(`UPDATE criteria SET weight = $2 WHERE id = $1`, [id, w]);
  await audit(ctx, 'criterion.weight', { type: 'project', id: projectId, projectId }, { weights });
}

/** Criteria suggestions from active attributes. Suggested criteria are inactive until a person accepts them; weights stay neutral (1). */
export async function suggestCriteria(ctx: Ctx, projectId: string) {
  need(ctx, 'editor');
  const attrs = (await listAttributes(ctx, projectId)).filter((a) => a.status === 'active');
  const existing = await listCriteria(ctx, projectId);
  const linked = new Set(existing.flatMap((c) => c.linkedAttributes));
  const dirFor: Record<string, 'higher_better' | 'lower_better' | 'boolean'> = { price: 'lower_better', weight: 'lower_better', setup_fee: 'lower_better', shipping_fee: 'lower_better', sso: 'boolean' };
  const created: Criterion[] = [];
  for (const a of attrs) {
    if (linked.has(a.key) || (a.type !== 'number' && a.type !== 'price' && a.type !== 'bool')) continue;
    created.push(await createCriterion(ctx, projectId, { name: a.displayName, weight: 1, direction: dirFor[a.key] ?? (a.type === 'bool' ? 'boolean' : 'higher_better'), linkedAttributes: [a.key] }, 'suggested'));
  }
  return created;
}

// ---------------- scenarios

export const ScenarioInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(1000).nullish(),
  weights: z.record(z.string(), z.number().min(0).max(100)).default({}),
  mustHaves: z.record(z.string(), z.boolean()).default({}),
  params: z.object({ seats: z.number().int().positive().nullish(), costBasis: z.enum(['as_listed', 'annual_total', 'monthly_equivalent']).optional(), includeShipping: z.boolean().optional() }).default({}),
});

export async function listScenarios(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows<Scenario>(await ctx.db.query(`SELECT * FROM scenarios WHERE project_id = $1 AND workspace_id = $2 ORDER BY sort_order, created_at`, [projectId, ctx.workspaceId]));
}

export async function createScenario(ctx: Ctx, projectId: string, input: z.input<typeof ScenarioInput>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  const s = ScenarioInput.parse(input);
  const errors = Object.keys(s.weights).length ? validateWeights(Object.values(s.weights)) : [];
  if (errors.length) throw badRequest(errors.join(' / '), { errors });
  const id = newId();
  const max = await ctx.db.one<{ m: number }>(`SELECT COALESCE(max(sort_order),0)::int AS m FROM scenarios WHERE project_id = $1`, [projectId]);
  await ctx.db.query(`INSERT INTO scenarios (id, workspace_id, project_id, name, description, weights, must_haves, params, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    id,
    ctx.workspaceId,
    projectId,
    s.name,
    s.description ?? null,
    JSON.stringify(s.weights),
    JSON.stringify(s.mustHaves),
    JSON.stringify(s.params),
    (max?.m ?? 0) + 10,
  ]);
  await audit(ctx, 'scenario.create', { type: 'scenario', id, projectId }, s);
  return mapRow<Scenario>((await ctx.db.one(`SELECT * FROM scenarios WHERE id = $1`, [id]))!);
}

export async function updateScenario(ctx: Ctx, id: string, input: Partial<z.input<typeof ScenarioInput>>) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'scenarios', id);
  const s = ScenarioInput.parse({ ...mapRow<Scenario>(cur), ...input });
  const errors = Object.keys(s.weights).length ? validateWeights(Object.values(s.weights)) : [];
  if (errors.length) throw badRequest(errors.join(' / '), { errors });
  await ctx.db.query(`UPDATE scenarios SET name=$2, description=$3, weights=$4, must_haves=$5, params=$6 WHERE id=$1`, [id, s.name, s.description ?? null, JSON.stringify(s.weights), JSON.stringify(s.mustHaves), JSON.stringify(s.params)]);
  await audit(ctx, 'scenario.update', { type: 'scenario', id, projectId: cur.project_id }, input);
  return mapRow<Scenario>((await ctx.db.one(`SELECT * FROM scenarios WHERE id = $1`, [id]))!);
}

export async function deleteScenario(ctx: Ctx, id: string) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'scenarios', id);
  await ctx.db.query(`DELETE FROM scenarios WHERE id = $1`, [id]);
  await audit(ctx, 'scenario.delete', { type: 'scenario', id, projectId: cur.project_id });
}

// ---------------- questions

export const QuestionInput = z.object({
  text: z.string().trim().min(1).max(1000),
  candidateId: z.string().nullish(),
  attributeKey: z.string().max(48).nullish(),
});

export async function listQuestions(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows<Question>(await ctx.db.query(`SELECT * FROM questions WHERE project_id = $1 AND workspace_id = $2 ORDER BY status = 'open' DESC, created_at DESC`, [projectId, ctx.workspaceId]));
}

export async function createQuestion(ctx: Ctx, projectId: string, input: z.infer<typeof QuestionInput>) {
  need(ctx, 'reviewer');
  await getProjectRow(ctx, projectId);
  if (input.candidateId) await assertInProject(ctx, 'candidates', input.candidateId, projectId);
  const dup = await ctx.db.one(`SELECT id FROM questions WHERE project_id = $1 AND status = 'open' AND text = $2 AND candidate_id IS NOT DISTINCT FROM $3`, [projectId, input.text, input.candidateId ?? null]);
  if (dup) return mapRow<Question>((await ctx.db.one(`SELECT * FROM questions WHERE id = $1`, [dup.id]))!);
  const id = newId();
  await ctx.db.query(`INSERT INTO questions (id, workspace_id, project_id, candidate_id, attribute_key, text, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    id,
    ctx.workspaceId,
    projectId,
    input.candidateId ?? null,
    input.attributeKey ?? null,
    input.text,
    ctx.actor.userId,
  ]);
  await indexEntity(ctx.db, ctx.workspaceId, 'question', id, projectId, input.text, '');
  await audit(ctx, 'question.create', { type: 'question', id, projectId });
  return mapRow<Question>((await ctx.db.one(`SELECT * FROM questions WHERE id = $1`, [id]))!);
}

export const AnswerInput = z.object({
  status: z.enum(['open', 'answered', 'closed']).optional(),
  answer: z.string().max(5000).nullish(),
  answerSourceId: z.string().nullish(),
  answerFactId: z.string().nullish(),
});

export async function updateQuestion(ctx: Ctx, id: string, input: z.infer<typeof AnswerInput>) {
  need(ctx, 'reviewer');
  const cur = await assertInProject(ctx, 'questions', id);
  if (input.answerSourceId) await assertInProject(ctx, 'sources', input.answerSourceId, cur.project_id);
  if (input.answerFactId) await assertInProject(ctx, 'facts', input.answerFactId, cur.project_id);
  const status = input.status ?? (input.answer ? 'answered' : cur.status);
  await ctx.db.query(`UPDATE questions SET status=$2, answer=$3, answer_source_id=$4, answer_fact_id=$5, answered_at = CASE WHEN $2 = 'answered' THEN now() ELSE answered_at END WHERE id=$1`, [
    id,
    status,
    input.answer !== undefined ? input.answer : cur.answer,
    input.answerSourceId !== undefined ? input.answerSourceId : cur.answer_source_id,
    input.answerFactId !== undefined ? input.answerFactId : cur.answer_fact_id,
  ]);
  await indexEntity(ctx.db, ctx.workspaceId, 'question', id, cur.project_id, cur.text, input.answer ?? cur.answer ?? '');
  await audit(ctx, 'question.update', { type: 'question', id, projectId: cur.project_id }, { status });
  return mapRow<Question>((await ctx.db.one(`SELECT * FROM questions WHERE id = $1`, [id]))!);
}

// ---------------- user notes (separate from facts) & comments

export async function listNotes(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows(
    await ctx.db.query(`SELECT n.*, u.name AS author_name FROM user_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.project_id = $1 AND n.workspace_id = $2 ORDER BY n.created_at DESC`, [projectId, ctx.workspaceId]),
  );
}

export async function createNote(ctx: Ctx, projectId: string, input: { id?: string; candidateId?: string | null; body: string }) {
  need(ctx, 'reviewer');
  await getProjectRow(ctx, projectId);
  if (input.candidateId) await assertInProject(ctx, 'candidates', input.candidateId, projectId);
  const body = z.string().trim().min(1).max(5000).parse(input.body);
  // client-generated ids allow idempotent offline sync
  const id = input.id && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : newId();
  const existing = await ctx.db.one(`SELECT workspace_id FROM user_notes WHERE id = $1`, [id]);
  if (existing) {
    if (existing.workspace_id !== ctx.workspaceId) throw notFound();
    return { id, duplicate: true };
  }
  await ctx.db.query(`INSERT INTO user_notes (id, workspace_id, project_id, candidate_id, body, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ctx.workspaceId, projectId, input.candidateId ?? null, body, ctx.actor.userId]);
  await audit(ctx, 'note.create', { type: 'note', id, projectId });
  return { id, duplicate: false };
}

export async function listComments(ctx: Ctx, projectId: string, entityType?: string, entityId?: string) {
  await getProjectRow(ctx, projectId);
  const params: unknown[] = [projectId, ctx.workspaceId];
  let where = 'c.project_id = $1 AND c.workspace_id = $2';
  if (entityType) {
    params.push(entityType);
    where += ` AND c.entity_type = $${params.length}`;
  }
  if (entityId) {
    params.push(entityId);
    where += ` AND c.entity_id = $${params.length}`;
  }
  return mapRows(await ctx.db.query(`SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE ${where} ORDER BY c.created_at`, params));
}

export async function createComment(ctx: Ctx, projectId: string, input: { entityType: string; entityId: string; body: string }) {
  need(ctx, 'reviewer');
  await getProjectRow(ctx, projectId);
  const entityType = z.enum(['fact', 'criterion', 'brief', 'candidate', 'source', 'decision', 'project']).parse(input.entityType);
  const entityTable = { fact: 'facts', criterion: 'criteria', brief: 'briefs', candidate: 'candidates', source: 'sources', decision: 'decisions' } as const;
  if (entityType === 'project') {
    if (input.entityId !== projectId) throw badRequest('対象が不正です');
  } else await assertInProject(ctx, entityTable[entityType], input.entityId, projectId);
  const id = newId();
  await ctx.db.query(`INSERT INTO comments (id, workspace_id, project_id, entity_type, entity_id, body, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    id,
    ctx.workspaceId,
    projectId,
    entityType,
    z.string().max(100).parse(input.entityId),
    z.string().trim().min(1).max(5000).parse(input.body),
    ctx.actor.userId,
  ]);
  await audit(ctx, 'comment.create', { type: entityType, id: input.entityId, projectId });
  return { id };
}
