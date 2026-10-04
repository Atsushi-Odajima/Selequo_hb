// Research Assistant: answers are always backed by citations to facts/sources of this project.
// Preset questions are computed deterministically (no AI needed). Free-form questions use the AI
// provider only when AI is enabled for the workspace and project; otherwise a citation-only search is returned.

import { z } from 'zod';
import { formatValue } from '../../shared/normalize';
import { recordAiCall, aiFor, validateCitations } from '../ai/guard';
import type { AIContextItem } from '../ai/provider';
import { audit, getProjectRow, type Ctx } from './core';
import { getCompare } from './comparison';
import { listFacts } from './facts';

export const AskInput = z.object({
  preset: z.enum(['big_differences', 'missing', 'no_official_source', 'weaknesses_besides_price', 'conflicts']).optional(),
  question: z.string().trim().max(1000).optional(),
  candidateIds: z.array(z.string()).max(2).optional(),
});

export interface Citation {
  ref: string;
  factId?: string;
  sourceId: string;
  label: string;
  sourceTitle: string | null;
  quality: string;
}

export interface AssistantAnswer {
  answer: string;
  items: { text: string; citations: Citation[] }[];
  citations: Citation[];
  usedAI: boolean;
  provider: string | null;
  droppedCitations?: string[];
  note: string;
}

export async function ask(ctx: Ctx, projectId: string, input: z.infer<typeof AskInput>): Promise<AssistantAnswer> {
  await getProjectRow(ctx, projectId);
  const cmp = await getCompare(ctx, projectId, { factPolicy: 'include_unreviewed' });
  const facts = await listFacts(ctx, projectId);
  const srcRows = await ctx.db.query<{ id: string; title: string | null; url: string | null; quality: string; extracted_text: string | null; status: string }>(
    `SELECT id, title, url, quality, extracted_text, status FROM sources WHERE project_id = $1 AND workspace_id = $2 AND status <> 'deleted'`,
    [projectId, ctx.workspaceId],
  );
  const src = new Map(srcRows.map((s) => [s.id, s]));
  const cand = new Map(cmp.candidates.map((c) => [c.id, c.name]));
  const attrName = new Map(cmp.rows.map((r) => [r.attributeKey, r.displayName]));
  const factById = new Map(facts.map((f) => [f.id, f]));
  const citeFact = (id: string): Citation | null => {
    const f = factById.get(id);
    const s = f ? src.get(f.sourceId) : undefined;
    if (!f || !s) return null;
    return { ref: `F:${f.id}`, factId: f.id, sourceId: s.id, label: `${cand.get(f.candidateId)} / ${f.rawLabel}: ${f.rawValue}`, sourceTitle: s.title ?? s.url, quality: s.quality };
  };
  const cites = (ids: string[]) => ids.map(citeFact).filter((c): c is Citation => !!c);
  const items: { text: string; citations: Citation[] }[] = [];
  const note = 'AIは候補を選びません。根拠（引用）を確認して判断してください。Unknownは0ではありません。';

  if (input.preset) {
    switch (input.preset) {
      case 'big_differences': {
        const ids = input.candidateIds?.length === 2 ? input.candidateIds : cmp.candidates.slice(0, 2).map((c) => c.id);
        for (const row of cmp.rows) {
          const a = row.cells.find((c) => c.candidateId === ids[0]);
          const b = row.cells.find((c) => c.candidateId === ids[1]);
          if (!a || !b || a.status !== 'value' || b.status !== 'value') continue;
          const va = a.values[0]?.normalized;
          const vb = b.values[0]?.normalized;
          let big = false;
          if (va?.kind === 'number' && vb?.kind === 'number' && va.unit === vb.unit) {
            const m = Math.max(Math.abs(va.value), Math.abs(vb.value));
            big = m > 0 && Math.abs(va.value - vb.value) / m >= 0.2;
          } else if (va && vb && formatValue(va) !== formatValue(vb)) big = va.kind !== 'number';
          if (big) items.push({ text: `${row.displayName}: ${cand.get(ids[0])} = ${a.display} / ${cand.get(ids[1])} = ${b.display}`, citations: cites([...a.factIds, ...b.factIds]) });
        }
        if (!items.length) items.push({ text: '大きな差（20%以上・異なる値）のある既知の項目は見つかりませんでした。Unknownの項目は比較できていません。', citations: [] });
        break;
      }
      case 'missing':
        for (const m of cmp.missing) items.push({ text: `${cand.get(m.candidateId)}: ${attrName.get(m.attributeKey)} が Unknown（出典のある情報がありません）`, citations: [] });
        if (!items.length) items.push({ text: '比較表の項目に Unknown はありません。', citations: [] });
        break;
      case 'no_official_source': {
        for (const row of cmp.rows)
          for (const c of row.cells) if (c.status !== 'unknown' && !c.officialSource) items.push({ text: `${cand.get(c.candidateId)} / ${row.displayName}: ${c.display} — 公式/メーカーの出典がありません`, citations: cites(c.factIds) });
        if (!items.length) items.push({ text: 'すべての既知の値に公式またはメーカーの出典があります。', citations: [] });
        break;
      }
      case 'weaknesses_besides_price':
        for (const c of cmp.criteria) {
          if (c.name.includes('価格') || c.name.toLowerCase().includes('price') || c.name.includes('コスト')) continue;
          for (const p of c.perCandidate) {
            if (p.subScore === 0) items.push({ text: `${cand.get(p.candidateId)}: 「${c.name}」が比較中で最も不利（${p.inputDisplay}）`, citations: cites(p.factIds) });
            if (p.mustHave === 'fail') items.push({ text: `${cand.get(p.candidateId)}: Must-have「${c.name}」を満たしていません（${p.inputDisplay}）`, citations: cites(p.factIds) });
            if (p.mustHave === 'unknown') items.push({ text: `${cand.get(p.candidateId)}: Must-have「${c.name}」が未確認（Unknown）`, citations: cites(p.factIds) });
          }
        }
        if (!items.length) items.push({ text: '価格以外のCriteriaで目立った弱点は見つかりませんでした（Criteria設定に依存します）。', citations: [] });
        break;
      case 'conflicts':
        for (const c of cmp.conflicts) items.push({ text: `${cand.get(c.candidateId)} / ${attrName.get(c.attributeKey)}: ${c.values.join(' と ')} が食い違っています`, citations: cites(c.factIds) });
        if (!items.length) items.push({ text: '未解決の Conflict はありません。', citations: [] });
        break;
    }
    const all = dedupe(items.flatMap((i) => i.citations));
    await audit(ctx, 'assistant.ask', { type: 'project', id: projectId, projectId }, { preset: input.preset, usedAI: false });
    return { answer: items.map((i) => `・${i.text}`).join('\n'), items, citations: all, usedAI: false, provider: null, note };
  }

  const question = input.question ?? '';
  if (!question) return { answer: '質問を入力してください。', items: [], citations: [], usedAI: false, provider: null, note };
  // retrieval: rank facts by keyword overlap (labels, values, candidate names)
  const q = question.toLowerCase();
  const terms = q
    .split(/[\s、。,.?？！!「」]+/)
    .filter((t) => t.length >= 2);
  const scored = facts
    .filter((f) => f.reviewState !== 'rejected' && src.has(f.sourceId))
    .map((f) => {
      const name = (cand.get(f.candidateId) ?? '').toLowerCase();
      const label = f.rawLabel.toLowerCase();
      const attr = (f.attributeKey ? (attrName.get(f.attributeKey) ?? '') : '').toLowerCase();
      const hay = `${name} ${label} ${f.rawValue} ${attr}`.toLowerCase();
      let score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      // Japanese questions have no spaces: also match labels / attribute names / candidate names contained in the question
      if (label.length >= 2 && q.includes(label)) score += 2;
      if (attr.length >= 2 && q.includes(attr)) score += 2;
      if (name.length >= 2 && q.includes(name)) score += 1;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, 40);
  const pool = (top.length ? top : scored.slice(0, 40)).map((s) => s.f);
  const context: AIContextItem[] = pool.map((f) => ({
    ref: `F:${f.id}`,
    text: `[${cand.get(f.candidateId)}] ${f.rawLabel}: ${f.rawValue}（${f.kind === 'opinion' ? '意見' : 'Fact'}・${f.reviewState}・出典品質 ${src.get(f.sourceId)?.quality}）`,
  }));
  const ai = await aiFor(ctx, projectId);
  if (!ai) {
    const found = top.slice(0, 10).map((s) => s.f);
    await audit(ctx, 'assistant.ask', { type: 'project', id: projectId, projectId }, { usedAI: false });
    return {
      answer: found.length ? 'AIはOFFです。質問に関連する出典付きFactを表示します。' : 'AIはOFFです。質問に一致する出典付きFactは見つかりませんでした（不明）。',
      items: found.map((f) => ({ text: `${cand.get(f.candidateId)} / ${f.rawLabel}: ${f.rawValue}`, citations: cites([f.id]) })),
      citations: cites(found.map((f) => f.id)),
      usedAI: false,
      provider: null,
      note,
    };
  }
  const res = await ai.answer({ question, context });
  await recordAiCall(ctx, projectId, ai.id, 'answer', question.length + context.reduce((s, c) => s + c.text.length, 0), res.answer.length);
  const { valid, dropped } = validateCitations(res.citations, context);
  const citations = valid.map((ref) => citeFact(ref.slice(2))).filter((c): c is Citation => !!c);
  await audit(ctx, 'assistant.ask', { type: 'project', id: projectId, projectId }, { usedAI: true, provider: ai.id, citations: citations.length, dropped: dropped.length });
  return {
    answer: citations.length ? res.answer : `${res.answer}\n\n（注意: 有効な引用がないため、この回答は根拠未確認です）`,
    items: [],
    citations,
    usedAI: true,
    provider: ai.id,
    droppedCitations: dropped,
    note,
  };
}

function dedupe(c: Citation[]) {
  const seen = new Set<string>();
  return c.filter((x) => (seen.has(x.ref) ? false : (seen.add(x.ref), true)));
}
