// Decision Brief generation/export and the human Decision Record (decide → review after N days).

import { z } from 'zod';
import { briefToHtml, briefToMarkdown, briefToText, buildBrief, type BriefContent } from '../../shared/brief';
import type { Decision } from '../../shared/types';
import { newId } from '../auth/crypto';
import { assertInProject, audit, badRequest, getProjectRow, mapRow, mapRows, need, notFound, type Ctx } from './core';
import { getCompare, getScenarioMatrix, loadCompareInput } from './comparison';
import { listQuestions } from './projects';
import { indexEntity } from './search';

export async function getDecision(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  const row = await ctx.db.one(`SELECT d.*, u.name AS decided_by_name FROM decisions d LEFT JOIN users u ON u.id = d.decided_by WHERE d.project_id = $1 AND d.workspace_id = $2 ORDER BY d.created_at DESC LIMIT 1`, [projectId, ctx.workspaceId]);
  return row ? mapRow<Decision & { decidedByName: string | null }>(row) : null;
}

export const DecisionInput = z.object({
  chosenCandidateId: z.string().nullish(),
  scenarioId: z.string().nullish(),
  reason: z.string().max(5000).default(''),
  assumptions: z.string().max(5000).nullish(),
  expectedOutcome: z.string().max(5000).nullish(),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  reviewInDays: z.number().int().min(1).max(3650).optional(),
  finalize: z.boolean().default(false),
});

/** Record the human decision. Only interactive users can finalize (API/MCP tokens cannot choose a candidate). */
export async function saveDecision(ctx: Ctx, projectId: string, input: z.input<typeof DecisionInput>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  const d = DecisionInput.parse(input);
  if (d.chosenCandidateId) await assertInProject(ctx, 'candidates', d.chosenCandidateId, projectId);
  if (d.scenarioId) await assertInProject(ctx, 'scenarios', d.scenarioId, projectId);
  if (d.finalize) {
    if (ctx.actor.type !== 'user') throw badRequest('判断の確定は画面から人が行います（API/MCPからは確定できません）');
    if (!d.chosenCandidateId) throw badRequest('選択した候補を指定してください');
    if (!d.reason.trim()) throw badRequest('判断理由を入力してください');
  }
  const reviewDate = d.reviewDate ?? (d.reviewInDays ? new Date(Date.now() + d.reviewInDays * 86400000).toISOString().slice(0, 10) : null);
  const cur = await getDecision(ctx, projectId);
  if (cur && cur.status === 'reviewed') throw badRequest('振り返り済みの判断は変更できません');
  const id = cur?.id ?? newId();
  if (!cur) await ctx.db.query(`INSERT INTO decisions (id, workspace_id, project_id) VALUES ($1,$2,$3)`, [id, ctx.workspaceId, projectId]);
  await ctx.db.query(
    `UPDATE decisions SET chosen_candidate_id=$2, scenario_id=$3, reason=$4, assumptions=$5, expected_outcome=$6, review_date=$7,
            status = CASE WHEN $8 THEN 'decided' ELSE status END, decided_by = CASE WHEN $8 THEN $9 ELSE decided_by END, decided_at = CASE WHEN $8 THEN now() ELSE decided_at END
      WHERE id = $1`,
    [id, d.chosenCandidateId ?? null, d.scenarioId ?? null, d.reason, d.assumptions ?? null, d.expectedOutcome ?? null, reviewDate, d.finalize, ctx.actor.userId],
  );
  if (d.finalize) {
    await ctx.db.query(`UPDATE candidates SET status = CASE WHEN id = $2 THEN 'chosen' WHEN status = 'chosen' THEN 'considering' ELSE status END WHERE project_id = $1`, [projectId, d.chosenCandidateId]);
    await ctx.db.query(`UPDATE projects SET status = 'decided', updated_at = now() WHERE id = $1`, [projectId]);
  }
  const fresh = (await getDecision(ctx, projectId))!;
  await indexEntity(ctx.db, ctx.workspaceId, 'decision', id, `判断: ${fresh.reason.slice(0, 80)}`, `${fresh.reason}\n${fresh.assumptions ?? ''}\n${fresh.expectedOutcome ?? ''}`);
  await audit(ctx, d.finalize ? 'decision.decide' : 'decision.draft', { type: 'decision', id, projectId }, { chosenCandidateId: d.chosenCandidateId, reviewDate });
  return fresh;
}

export const ReviewDecisionInput = z.object({ actualResult: z.string().min(1).max(5000), lessons: z.string().max(5000).nullish() });

export async function reviewDecision(ctx: Ctx, projectId: string, input: z.infer<typeof ReviewDecisionInput>) {
  need(ctx, 'editor');
  const cur = await getDecision(ctx, projectId);
  if (!cur || cur.status === 'draft') throw badRequest('確定した判断がありません');
  await ctx.db.query(`UPDATE decisions SET actual_result = $2, lessons = $3, status = 'reviewed', reviewed_at = now() WHERE id = $1`, [cur.id, input.actualResult, input.lessons ?? null]);
  await audit(ctx, 'decision.review', { type: 'decision', id: cur.id, projectId }, {});
  return getDecision(ctx, projectId);
}

/** Decisions whose review date has arrived (for the "90日後レビュー" reminder list). */
export async function dueReviews(ctx: Ctx, today = new Date().toISOString().slice(0, 10)) {
  return mapRows(
    await ctx.db.query(
      `SELECT d.id, d.project_id, d.review_date, p.title FROM decisions d JOIN projects p ON p.id = d.project_id WHERE d.workspace_id = $1 AND d.status = 'decided' AND d.review_date <= $2 ORDER BY d.review_date`,
      [ctx.workspaceId, today],
    ),
  );
}

export async function buildProjectBrief(ctx: Ctx, projectId: string): Promise<BriefContent> {
  const { input, project } = await loadCompareInput(ctx, projectId);
  const decision = await getDecision(ctx, projectId);
  const compare = await getCompare(ctx, projectId, { scenarioId: decision?.scenarioId ?? null });
  const matrix = await getScenarioMatrix(ctx, projectId);
  const questions = await listQuestions(ctx, projectId);
  const srcRows = await ctx.db.query(`SELECT s.id, s.title, s.url, s.type, s.quality, s.retrieved_at, s.captured_at FROM sources s WHERE s.project_id = $1 AND s.status <> 'deleted'`, [projectId]);
  return buildBrief({
    project: { title: project.title, purpose: project.purpose, category: project.category, deadline: project.deadline ? String(project.deadline instanceof Date ? project.deadline.toISOString().slice(0, 10) : project.deadline) : null, currency: project.currency },
    compare,
    candidates: input.candidates.map((c) => ({ id: c.id, name: c.name, provider: (c as { provider?: string | null }).provider ?? null })),
    criteria: input.criteria,
    facts: input.facts,
    sources: mapRows(srcRows),
    prices: input.prices,
    matrix,
    questions,
    decision,
  });
}

export async function createBriefVersion(ctx: Ctx, projectId: string) {
  need(ctx, 'editor');
  const content = await buildProjectBrief(ctx, projectId);
  const v = await ctx.db.one<{ v: number }>(`SELECT COALESCE(max(version),0)::int AS v FROM briefs WHERE project_id = $1`, [projectId]);
  const id = newId();
  await ctx.db.query(`INSERT INTO briefs (id, workspace_id, project_id, version, content, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ctx.workspaceId, projectId, (v?.v ?? 0) + 1, JSON.stringify(content), ctx.actor.userId]);
  await audit(ctx, 'brief.create', { type: 'brief', id, projectId }, { version: (v?.v ?? 0) + 1 });
  return { id, version: (v?.v ?? 0) + 1, content };
}

export async function listBriefs(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  return mapRows(await ctx.db.query(`SELECT b.id, b.version, b.review_state, b.created_at, u.name AS created_by_name FROM briefs b LEFT JOIN users u ON u.id = b.created_by WHERE b.project_id = $1 AND b.workspace_id = $2 ORDER BY b.version DESC`, [projectId, ctx.workspaceId]));
}

export async function getBrief(ctx: Ctx, briefId: string) {
  const row = await assertInProject(ctx, 'briefs', briefId);
  return mapRow<{ id: string; projectId: string; version: number; content: BriefContent; reviewState: string; createdAt: string }>(row);
}

export async function setBriefReview(ctx: Ctx, briefId: string, state: 'draft' | 'in_review' | 'approved') {
  need(ctx, 'reviewer');
  const row = await assertInProject(ctx, 'briefs', briefId);
  await ctx.db.query(`UPDATE briefs SET review_state = $2 WHERE id = $1`, [briefId, z.enum(['draft', 'in_review', 'approved']).parse(state)]);
  await audit(ctx, 'brief.review', { type: 'brief', id: briefId, projectId: row.project_id }, { state });
}

export type ExportFormat = 'md' | 'html' | 'txt' | 'json' | 'pdf';

export async function exportBrief(ctx: Ctx, content: BriefContent, format: ExportFormat, projectId: string): Promise<{ body: Uint8Array | string; mime: string; ext: string }> {
  await audit(ctx, 'brief.export', { type: 'project', id: projectId, projectId }, { format });
  switch (format) {
    case 'md':
      return { body: briefToMarkdown(content), mime: 'text/markdown; charset=utf-8', ext: 'md' };
    case 'txt':
      return { body: briefToText(content), mime: 'text/plain; charset=utf-8', ext: 'txt' };
    case 'json':
      return { body: JSON.stringify(content, null, 2), mime: 'application/json; charset=utf-8', ext: 'json' };
    case 'html':
      return { body: briefToHtml(content), mime: 'text/html; charset=utf-8', ext: 'html' };
    case 'pdf':
      return { body: await htmlToPdf(briefToHtml(content), ctx.config.pdfRenderer), mime: 'application/pdf', ext: 'pdf' };
    default:
      throw notFound('形式');
  }
}

/** Server-side PDF via headless Chromium (playwright-core). All network requests from the page are blocked. */
export async function htmlToPdf(html: string, renderer: 'chromium' | 'none'): Promise<Uint8Array> {
  if (renderer !== 'chromium') throw badRequest('PDF出力は無効です。HTML出力をブラウザで印刷してPDF保存してください');
  const { chromium } = await import('playwright-core');
  // playwright-core finds its pinned Chromium via PLAYWRIGHT_BROWSERS_PATH; CHROMIUM_PATH overrides it.
  const exe = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    return new Uint8Array(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } }));
  } finally {
    await browser.close();
  }
}
