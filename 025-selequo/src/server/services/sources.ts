// Sources and the import → extraction → citation pipeline. Original sources are stored separately
// from facts; every fact points back to its source with a precise range (text offsets, PDF page,
// image region, CSV cell or manual author).

import { z } from 'zod';
import { matchLabel, type AliasRule } from '../../shared/attributes';
import { normalizeValue, shapeFor } from '../../shared/normalize';
import { parsePrice } from '../../shared/price';
import { parseCsv, isOpinion } from '../../shared/textsafety';
import { SOURCE_QUALITIES, type Source, type SourceRange } from '../../shared/types';
import { newId, sha256 } from '../auth/crypto';
import { aiFor, groundFacts, recordAiCall } from '../ai/guard';
import { extractFacts, type ExtractedFact } from '../extract/heuristic';
import { FetchError } from '../import/fetcher';
import { parseHtml, parsePdf, sniffType, imageSize } from '../import/parsers';
import { signFileUrl } from '../storage';
import { assertInProject, audit, badRequest, getProjectRow, mapRow, mapRows, need, notFound, type Ctx } from './core';
import { indexEntity, unindexEntity } from './search';
import { touch } from './projects';

const QualitySchema = z.enum(SOURCE_QUALITIES);

export const UrlSourceInput = z.object({
  url: z.string().trim().url().max(2000),
  candidateId: z.string().nullish(),
  quality: QualitySchema.optional(),
  title: z.string().max(300).nullish(),
  aiEnabled: z.boolean().optional(),
});

async function insertSource(ctx: Ctx, projectId: string, s: Partial<Record<string, unknown>> & { type: string }) {
  const id = newId();
  await ctx.db.query(
    `INSERT INTO sources (id, workspace_id, project_id, candidate_id, type, url, file_key, file_name, mime, size_bytes, title, publisher, quality, captured_at, retrieved_at, hash, status, ai_enabled, extracted_text, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      id,
      ctx.workspaceId,
      projectId,
      s.candidateId ?? null,
      s.type,
      s.url ?? null,
      s.fileKey ?? null,
      s.fileName ?? null,
      s.mime ?? null,
      s.size ?? null,
      s.title ?? null,
      s.publisher ?? null,
      s.quality ?? 'unknown',
      s.capturedAt ?? null,
      s.retrievedAt ?? null,
      s.hash ?? null,
      s.status ?? 'pending',
      s.aiEnabled ?? true,
      s.text ?? null,
      ctx.actor.userId,
    ],
  );
  return id;
}

export async function addUrlSource(ctx: Ctx, projectId: string, input: z.infer<typeof UrlSourceInput>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  if (input.candidateId) await assertInProject(ctx, 'candidates', input.candidateId, projectId);
  const id = await insertSource(ctx, projectId, { type: 'web', url: input.url, candidateId: input.candidateId, quality: input.quality ?? 'unknown', title: input.title, aiEnabled: input.aiEnabled });
  await ctx.jobs.enqueue(ctx.db, ctx.workspaceId, 'process_source', { sourceId: id });
  await audit(ctx, 'source.add', { type: 'source', id, projectId }, { type: 'web', url: input.url });
  ctx.jobs.kick();
  return getSource(ctx, id);
}

export const FileSourceMeta = z.object({
  candidateId: z.string().nullish(),
  kind: z.enum(['auto', 'screenshot', 'image', 'pdf', 'text', 'csv']).default('auto'),
  quality: QualitySchema.optional(),
  title: z.string().max(300).nullish(),
  capturedAt: z.string().datetime({ offset: true }).nullish(),
  url: z.string().url().max(2000).nullish(),
  aiEnabled: z.boolean().optional(),
});

export async function addFileSource(ctx: Ctx, projectId: string, file: { data: Uint8Array; fileName: string }, metaIn: z.input<typeof FileSourceMeta>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  const meta = FileSourceMeta.parse(metaIn);
  if (meta.candidateId) await assertInProject(ctx, 'candidates', meta.candidateId, projectId);
  if (file.data.length === 0) throw badRequest('空のファイルです');
  if (file.data.length > ctx.config.maxUploadBytes) throw badRequest('ファイルサイズが上限を超えています');
  const sniffed = sniffType(file.data);
  if (!sniffed) throw badRequest('対応していないファイル形式です（PDF / PNG / JPEG / WebP / テキスト / CSV）');
  let type: string;
  if (sniffed.kind === 'pdf') type = 'pdf';
  else if (sniffed.kind === 'image') type = meta.kind === 'image' ? 'image' : 'screenshot';
  else type = meta.kind === 'csv' || /\.csv$/i.test(file.fileName) ? 'csv' : 'text';
  if ((meta.kind === 'pdf' && type !== 'pdf') || ((meta.kind === 'screenshot' || meta.kind === 'image') && sniffed.kind !== 'image')) throw badRequest('ファイルの内容が指定された種類と一致しません');
  const hash = sha256(file.data);
  const safeName = file.fileName.replace(/[^\w.\-぀-ヿ一-鿿 ]+/g, '_').slice(0, 120) || 'upload';
  const fileKey = `ws/${ctx.workspaceId}/p/${projectId}/${hash.slice(0, 16)}-${newId().slice(0, 8)}${sniffed.kind === 'pdf' ? '.pdf' : sniffed.kind === 'image' ? '.' + sniffed.mime.split('/')[1] : '.txt'}`;
  await ctx.storage.put(fileKey, file.data, sniffed.mime);
  const id = await insertSource(ctx, projectId, {
    type,
    fileKey,
    fileName: safeName,
    mime: sniffed.mime,
    size: file.data.length,
    hash,
    title: meta.title ?? safeName,
    quality: meta.quality ?? (type === 'screenshot' ? 'unknown' : 'unknown'),
    candidateId: meta.candidateId,
    capturedAt: meta.capturedAt ?? (type === 'screenshot' || type === 'image' ? new Date().toISOString() : null),
    url: meta.url,
    aiEnabled: meta.aiEnabled,
  });
  await ctx.jobs.enqueue(ctx.db, ctx.workspaceId, 'process_source', { sourceId: id });
  await audit(ctx, 'source.add', { type: 'source', id, projectId }, { type, fileName: safeName, size: file.data.length });
  ctx.jobs.kick();
  return getSource(ctx, id);
}

export const TextSourceInput = z.object({
  text: z.string().min(1).max(200_000),
  title: z.string().max(300).nullish(),
  candidateId: z.string().nullish(),
  quality: QualitySchema.optional(),
  url: z.string().url().max(2000).nullish(),
  aiEnabled: z.boolean().optional(),
});

export async function addTextSource(ctx: Ctx, projectId: string, input: z.infer<typeof TextSourceInput>) {
  need(ctx, 'editor');
  await getProjectRow(ctx, projectId);
  if (input.candidateId) await assertInProject(ctx, 'candidates', input.candidateId, projectId);
  const id = await insertSource(ctx, projectId, {
    type: 'text',
    text: input.text,
    title: input.title ?? input.text.slice(0, 40),
    candidateId: input.candidateId,
    quality: input.quality ?? 'manual',
    hash: sha256(input.text),
    url: input.url,
    capturedAt: new Date().toISOString(),
    aiEnabled: input.aiEnabled,
  });
  await ctx.jobs.enqueue(ctx.db, ctx.workspaceId, 'process_source', { sourceId: id });
  await audit(ctx, 'source.add', { type: 'source', id, projectId }, { type: 'text', chars: input.text.length });
  ctx.jobs.kick();
  return getSource(ctx, id);
}

export async function getSource(ctx: Ctx, id: string) {
  const row = await ctx.db.one(`SELECT s.*, u.name AS created_by_name FROM sources s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = $1 AND s.workspace_id = $2`, [id, ctx.workspaceId]);
  if (!row) throw notFound('ソース');
  const src = mapRow<Source & { extractedText: string | null; pages: string[] | null; sizeBytes: number | null }>(row);
  return { ...src, fileUrl: src.fileKey && src.status !== 'deleted' ? signFileUrl(ctx.config.secret, src.fileKey) : null };
}

export async function listSources(ctx: Ctx, projectId: string) {
  await getProjectRow(ctx, projectId);
  const rows = await ctx.db.query(
    `SELECT s.id, s.project_id, s.candidate_id, s.type, s.url, s.file_key, s.file_name, s.mime, s.title, s.publisher, s.quality, s.captured_at, s.published_at, s.retrieved_at, s.hash, s.status, s.ai_enabled, s.error, s.injection_flags, s.created_by, s.created_at,
            u.name AS created_by_name, (SELECT count(*)::int FROM facts f WHERE f.source_id = s.id) AS fact_count
       FROM sources s LEFT JOIN users u ON u.id = s.created_by WHERE s.project_id = $1 AND s.workspace_id = $2 AND s.status <> 'deleted' ORDER BY s.created_at DESC`,
    [projectId, ctx.workspaceId],
  );
  return mapRows<Source & { factCount: number }>(rows).map((s) => ({ ...s, fileUrl: s.fileKey ? signFileUrl(ctx.config.secret, s.fileKey) : null }));
}

export async function updateSource(ctx: Ctx, id: string, input: { quality?: string; title?: string; publisher?: string; candidateId?: string | null; aiEnabled?: boolean; publishedAt?: string | null }) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'sources', id);
  if (input.candidateId) await assertInProject(ctx, 'candidates', input.candidateId, cur.project_id);
  await ctx.db.query(`UPDATE sources SET quality=$2, title=$3, publisher=$4, candidate_id=$5, ai_enabled=$6, published_at=$7 WHERE id=$1`, [
    id,
    input.quality ? QualitySchema.parse(input.quality) : cur.quality,
    input.title ?? cur.title,
    input.publisher ?? cur.publisher,
    input.candidateId !== undefined ? input.candidateId : cur.candidate_id,
    input.aiEnabled ?? cur.ai_enabled,
    input.publishedAt !== undefined ? input.publishedAt : cur.published_at,
  ]);
  if (input.candidateId && input.candidateId !== cur.candidate_id) {
    await ctx.db.query(`UPDATE facts SET candidate_id = $2 WHERE source_id = $1 AND review_state = 'candidate'`, [id, input.candidateId]);
    await ctx.db.query(`UPDATE price_snapshots SET candidate_id = $2 WHERE source_id = $1`, [id, input.candidateId]);
    if (!cur.candidate_id && cur.status === 'ready') {
      await ctx.jobs.enqueue(ctx.db, ctx.workspaceId, 'process_source', { sourceId: id });
      ctx.jobs.kick();
    }
  }
  await audit(ctx, input.aiEnabled !== undefined && input.aiEnabled !== cur.ai_enabled ? 'source.ai_toggle' : 'source.update', { type: 'source', id, projectId: cur.project_id }, input);
  return getSource(ctx, id);
}

/** Delete a source: file, extracted text, facts, price snapshots, search index and embeddings are removed. */
export async function deleteSource(ctx: Ctx, id: string) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'sources', id);
  if (cur.file_key) await ctx.storage.delete(cur.file_key);
  const facts = await ctx.db.query<{ id: string }>(`SELECT id FROM facts WHERE source_id = $1`, [id]);
  for (const f of facts) await unindexEntity(ctx.db, ctx.workspaceId, 'fact', f.id);
  await ctx.db.query(`UPDATE questions SET answer_fact_id = NULL WHERE answer_fact_id = ANY($1)`, [facts.map((f) => f.id)]);
  await ctx.db.query(`DELETE FROM facts WHERE source_id = $1`, [id]);
  await ctx.db.query(`DELETE FROM price_snapshots WHERE source_id = $1`, [id]);
  await ctx.db.query(`UPDATE sources SET status = 'deleted', deleted_at = now(), extracted_text = NULL, pages = NULL, file_key = NULL WHERE id = $1`, [id]);
  await unindexEntity(ctx.db, ctx.workspaceId, 'source', id);
  await ctx.db.query(`DELETE FROM jobs WHERE payload->>'sourceId' = $1 AND status = 'queued'`, [id]);
  await audit(ctx, 'source.delete', { type: 'source', id, projectId: cur.project_id }, { facts: facts.length });
  await touch(ctx, cur.project_id);
}

export async function reprocessSource(ctx: Ctx, id: string) {
  need(ctx, 'editor');
  const cur = await assertInProject(ctx, 'sources', id);
  if (cur.status === 'deleted') throw badRequest('削除済みのソースです');
  await ctx.db.query(`UPDATE sources SET status = 'pending', error = NULL WHERE id = $1`, [id]);
  await ctx.jobs.enqueue(ctx.db, ctx.workspaceId, 'process_source', { sourceId: id });
  ctx.jobs.kick();
  await audit(ctx, 'source.reprocess', { type: 'source', id, projectId: cur.project_id });
}

async function projectRules(ctx: Ctx, projectId: string): Promise<AliasRule[]> {
  return (await ctx.db.query<{ pattern: string; attribute_key: string }>(`SELECT pattern, attribute_key FROM normalization_rules WHERE project_id = $1 AND active = true`, [projectId])).map((r) => ({
    pattern: r.pattern,
    attributeKey: r.attribute_key,
  }));
}

/** Job handler: fetch/parse/extract a source. Runs with a system context scoped to the source's workspace. */
export async function processSource(ctx: Ctx, sourceId: string) {
  const src = await ctx.db.one(`SELECT * FROM sources WHERE id = $1 AND workspace_id = $2`, [sourceId, ctx.workspaceId]);
  if (!src || src.status === 'deleted') return;
  await ctx.db.query(`UPDATE sources SET status = 'processing' WHERE id = $1`, [sourceId]);
  try {
    let pages: string[] = [];
    let paged = false;
    const patch: Record<string, unknown> = {};
    if (src.type === 'web') {
      const res = await ctx.fetcher.fetch(src.url);
      const fileKey = `ws/${ctx.workspaceId}/p/${src.project_id}/web-${sha256(res.body).slice(0, 16)}${/pdf/i.test(res.contentType) ? '.pdf' : /html/i.test(res.contentType) ? '.html' : '.bin'}`;
      await ctx.storage.put(fileKey, res.body, res.contentType);
      patch.file_key = fileKey;
      patch.mime = res.contentType.split(';')[0];
      patch.size_bytes = res.body.length;
      patch.hash = sha256(res.body);
      patch.retrieved_at = res.retrievedAt;
      patch.captured_at = res.retrievedAt;
      patch.url = res.finalUrl;
      if (/pdf/i.test(res.contentType)) {
        const doc = await parsePdf(res.body);
        pages = doc.pages;
        paged = true;
        patch.title = src.title ?? doc.title;
      } else if (/html/i.test(res.contentType)) {
        const doc = parseHtml(new TextDecoder().decode(res.body), res.finalUrl);
        pages = doc.pages;
        patch.title = src.title ?? doc.title;
        patch.publisher = src.publisher ?? doc.publisher;
        if (doc.publishedAt && !Number.isNaN(Date.parse(doc.publishedAt))) patch.published_at = new Date(doc.publishedAt).toISOString();
      } else pages = [new TextDecoder().decode(res.body)];
    } else if (src.type === 'pdf') {
      const data = await ctx.storage.get(src.file_key);
      if (!data) throw new Error('ファイルが見つかりません');
      const doc = await parsePdf(data);
      pages = doc.pages;
      paged = true;
      if (!src.title || src.title === src.file_name) patch.title = doc.title ?? src.title;
      patch.retrieved_at = new Date().toISOString();
    } else if (src.type === 'screenshot' || src.type === 'image') {
      const data = await ctx.storage.get(src.file_key);
      if (!data) throw new Error('ファイルが見つかりません');
      const size = imageSize(data);
      patch.pages = null;
      const ai = await aiFor(ctx, src.project_id, src as { ai_enabled: boolean });
      if (ai?.transcribeImage) {
        const text = await ai.transcribeImage({ data, mime: src.mime });
        await recordAiCall(ctx, src.project_id, ai.id, 'vision', data.length, text.length);
        pages = text ? [text] : [];
      }
      patch.publisher = src.publisher ?? (size ? `${size.width}×${size.height}px` : null);
    } else if (src.type === 'text') {
      pages = [src.extracted_text ?? ''];
    } else if (src.type === 'csv') {
      const data = src.file_key ? await ctx.storage.get(src.file_key) : null;
      const text = data ? new TextDecoder().decode(data) : (src.extracted_text ?? '');
      await importCsvFacts(ctx, src, text);
      pages = [];
      patch.extracted_text = text.slice(0, 200_000);
    }
    const text = pages.join('\n\f\n');
    if (src.type !== 'csv') patch.extracted_text = text.slice(0, 500_000);
    patch.pages = paged ? JSON.stringify(pages) : null;

    let injectionFlags: string[] = [];
    if (pages.some((p) => p.trim())) {
      const rules = await projectRules(ctx, src.project_id);
      const forceOpinion = src.quality === 'user_review';
      const { facts, injectionFlags: flags } = extractFacts({ pages, paged, rules, forceOpinion });
      injectionFlags = flags;
      let all: (ExtractedFact & { by: string })[] = facts.map((f) => ({ ...f, by: 'parser' }));
      const ai = await aiFor(ctx, src.project_id, src as { ai_enabled: boolean });
      if (ai) {
        const project = await ctx.db.one(`SELECT title, purpose FROM projects WHERE id = $1`, [src.project_id]);
        const raw = await ai.extractFacts({ pages, paged, hint: `${project?.title ?? ''} ${project?.purpose ?? ''}`.slice(0, 300) });
        await recordAiCall(ctx, src.project_id, ai.id, 'extract', text.length, JSON.stringify(raw).length);
        const grounded = groundFacts(raw, pages);
        for (const g of grounded) {
          const m = matchLabel(g.label, rules);
          let normalized = null;
          let issue = null;
          if (m.key) {
            const r = normalizeValue(shapeFor(m.key), g.value);
            normalized = r.value;
            issue = r.issue;
          }
          const dupe = all.some((f) => (f.attributeKey && f.attributeKey === m.key && JSON.stringify(f.normalizedValue) === JSON.stringify(normalized)) || (f.rawLabel === g.label && f.rawValue === g.value));
          if (dupe) continue;
          const range: SourceRange = paged
            ? { type: 'pdf', page: g.pageIndex + 1, start: g.start, end: g.end, context: g.quote.slice(0, 240) }
            : { type: 'text', start: g.start, end: g.end, context: g.quote.slice(0, 240) };
          all.push({
            rawLabel: g.label,
            rawValue: g.value,
            attributeKey: issue === 'unit_mismatch' ? null : m.key,
            ambiguous: m.ambiguous,
            normalizedValue: issue === 'unit_mismatch' ? null : normalized,
            unit: normalized?.kind === 'number' ? normalized.unit : null,
            issue,
            kind: forceOpinion || isOpinion(g.quote) ? 'opinion' : 'fact',
            sourceRange: range,
            confidence: 0.7,
            by: `ai:${ai.id}`,
          });
        }
      }
      // re-processing replaces only unreviewed candidates from this source
      await ctx.db.query(`DELETE FROM facts WHERE source_id = $1 AND review_state = 'candidate' AND extracted_by <> 'manual'`, [sourceId]);
      if (src.candidate_id) {
        for (const f of all) await insertFact(ctx, { projectId: src.project_id, candidateId: src.candidate_id, sourceId, fact: f, extractedBy: f.by, capturedAt: (patch.captured_at as string) ?? src.captured_at ?? src.created_at });
      } else {
        // No candidate linked: keep the text; facts are created once the source is assigned to a candidate.
        all = [];
      }
    }
    await ctx.db.query(
      `UPDATE sources SET status = 'ready', error = NULL, injection_flags = $2, extracted_text = $3, pages = $4,
              file_key = COALESCE($5, file_key), mime = COALESCE($6, mime), size_bytes = COALESCE($7, size_bytes), hash = COALESCE($8, hash),
              retrieved_at = COALESCE($9, retrieved_at), captured_at = COALESCE($10, captured_at), url = COALESCE($11, url),
              title = COALESCE($12, title), publisher = COALESCE($13, publisher), published_at = COALESCE($14, published_at)
        WHERE id = $1`,
      [
        sourceId,
        JSON.stringify(injectionFlags),
        patch.extracted_text ?? null,
        patch.pages ?? null,
        patch.file_key ?? null,
        patch.mime ?? null,
        patch.size_bytes ?? null,
        patch.hash ?? null,
        patch.retrieved_at ?? null,
        patch.captured_at ?? null,
        patch.url ?? null,
        patch.title ?? null,
        patch.publisher ?? null,
        patch.published_at ?? null,
      ],
    );
    const fresh = await ctx.db.one(`SELECT title, url, extracted_text, project_id FROM sources WHERE id = $1`, [sourceId]);
    await indexEntity(ctx.db, ctx.workspaceId, 'source', sourceId, fresh?.title ?? fresh?.url ?? 'source', `${fresh?.url ?? ''}\n${fresh?.extracted_text ?? ''}`);
    await touch(ctx, src.project_id);
  } catch (e) {
    const msg = e instanceof FetchError ? e.message : `処理に失敗しました: ${(e as Error).message}`;
    await ctx.db.query(`UPDATE sources SET status = 'failed', error = $2 WHERE id = $1`, [sourceId, msg.slice(0, 500)]);
  }
}

export async function insertFact(
  ctx: Ctx,
  x: { projectId: string; candidateId: string; sourceId: string; fact: ExtractedFact; extractedBy: string; capturedAt?: string | null; reviewState?: string },
) {
  const id = newId();
  const f = x.fact;
  await ctx.db.query(
    `INSERT INTO facts (id, workspace_id, project_id, candidate_id, source_id, attribute_key, raw_label, raw_value, normalized_value, unit, issue, kind, source_range, confidence, review_state, extracted_by, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      id,
      ctx.workspaceId,
      x.projectId,
      x.candidateId,
      x.sourceId,
      f.attributeKey,
      f.rawLabel.slice(0, 200),
      f.rawValue.slice(0, 1000),
      f.normalizedValue ? JSON.stringify(f.normalizedValue) : null,
      f.unit,
      f.issue ?? (f.ambiguous.length ? 'ambiguous' : null),
      f.kind,
      JSON.stringify(f.sourceRange),
      f.confidence,
      x.reviewState ?? 'candidate',
      x.extractedBy,
      ctx.actor.userId,
    ],
  );
  // price facts produce a price snapshot (history is kept; never overwritten)
  if (f.kind === 'fact' && f.attributeKey === 'price') {
    const p = parsePrice(f.rawValue);
    if (p) {
      await ctx.db.query(
        `INSERT INTO price_snapshots (id, workspace_id, project_id, candidate_id, source_id, fact_id, amount, currency, tax, billing_period, per_seat, captured_at, created_by, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [newId(), ctx.workspaceId, x.projectId, x.candidateId, x.sourceId, id, p.amount, p.currency, p.tax, p.billingPeriod, p.perSeat, x.capturedAt ?? new Date().toISOString(), ctx.actor.userId, p.shippingIncluded === true ? '送料込み' : p.shippingIncluded === false ? '送料別' : null],
      );
    }
  }
  await indexEntity(ctx.db, ctx.workspaceId, 'fact', id, `${f.rawLabel}: ${f.rawValue}`.slice(0, 300), f.sourceRange.context ?? '');
  return id;
}

/** CSV import: long format (candidate,label,value) or wide format (label, <candidate names...>). */
async function importCsvFacts(ctx: Ctx, src: Record<string, any>, text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSVにデータ行がありません');
  const header = rows[0].map((h) => h.trim());
  const cands = await ctx.db.query<{ id: string; name: string }>(`SELECT id, name FROM candidates WHERE project_id = $1`, [src.project_id]);
  const byName = new Map(cands.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const rules = await projectRules(ctx, src.project_id);
  const lower = header.map((h) => h.toLowerCase());
  const longFmt = ['candidate', 'label', 'value'].every((k) => lower.includes(k)) || ['候補', '項目', '値'].every((k) => header.includes(k));
  const make = (label: string, value: string, row: number, column: string) => {
    const m = matchLabel(label, rules);
    const r = m.key ? normalizeValue(shapeFor(m.key), value) : { value: null, issue: null };
    return {
      rawLabel: label,
      rawValue: value,
      attributeKey: r.issue === 'unit_mismatch' ? null : m.key,
      ambiguous: m.ambiguous,
      normalizedValue: r.issue === 'unit_mismatch' ? null : r.value,
      unit: r.value?.kind === 'number' ? r.value.unit : null,
      issue: r.issue,
      kind: isOpinion(value) ? ('opinion' as const) : ('fact' as const),
      sourceRange: { type: 'csv' as const, row: row + 1, column, context: `${label}: ${value}`.slice(0, 240) },
      confidence: 0.8,
    };
  };
  await ctx.db.query(`DELETE FROM facts WHERE source_id = $1 AND review_state = 'candidate'`, [src.id]);
  if (longFmt) {
    const ci = lower.indexOf('candidate') >= 0 ? lower.indexOf('candidate') : header.indexOf('候補');
    const li = lower.indexOf('label') >= 0 ? lower.indexOf('label') : header.indexOf('項目');
    const vi = lower.indexOf('value') >= 0 ? lower.indexOf('value') : header.indexOf('値');
    for (let r = 1; r < rows.length; r++) {
      const candId = byName.get((rows[r][ci] ?? '').trim().toLowerCase()) ?? src.candidate_id;
      if (!candId || !rows[r][li] || !rows[r][vi]) continue;
      await insertFact(ctx, { projectId: src.project_id, candidateId: candId, sourceId: src.id, fact: make(rows[r][li].trim(), rows[r][vi].trim(), r, header[vi]), extractedBy: 'csv' });
    }
  } else {
    for (let c = 1; c < header.length; c++) {
      const candId = byName.get(header[c].toLowerCase());
      if (!candId) continue;
      for (let r = 1; r < rows.length; r++) {
        const label = (rows[r][0] ?? '').trim();
        const value = (rows[r][c] ?? '').trim();
        if (!label || !value) continue;
        await insertFact(ctx, { projectId: src.project_id, candidateId: candId, sourceId: src.id, fact: make(label, value, r, header[c]), extractedBy: 'csv' });
      }
    }
  }
}

/** Get or create the per-user manual source used for manually entered facts (citation = 入力者). */
export async function manualSource(ctx: Ctx, projectId: string, candidateId: string) {
  const existing = await ctx.db.one<{ id: string }>(`SELECT id FROM sources WHERE project_id = $1 AND candidate_id = $2 AND type = 'manual' AND created_by = $3 AND status <> 'deleted'`, [
    projectId,
    candidateId,
    ctx.actor.userId,
  ]);
  if (existing) return existing.id;
  return insertSource(ctx, projectId, {
    type: 'manual',
    candidateId,
    quality: 'manual',
    title: `手入力（${ctx.actor.name}）`,
    status: 'ready',
    capturedAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
  });
}
