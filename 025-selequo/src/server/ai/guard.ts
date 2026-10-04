// Guard layer around AI providers: per workspace/project/source AI switches, call ledger,
// grounding of extracted facts and validation of citations.

import { newId } from '../auth/crypto';
import { aiAllowed, type Ctx } from '../services/core';
import type { AIContextItem, AIExtractedFact, AIProvider } from './provider';

export async function aiFor(ctx: Ctx, projectId: string, source?: { ai_enabled: boolean } | null): Promise<AIProvider | null> {
  if (!ctx.aiProvider) return null;
  const ws = await ctx.db.one<{ ai_enabled: boolean }>(`SELECT ai_enabled FROM workspaces WHERE id = $1`, [ctx.workspaceId]);
  const p = await ctx.db.one<{ ai_enabled: boolean }>(`SELECT ai_enabled FROM projects WHERE id = $1 AND workspace_id = $2`, [projectId, ctx.workspaceId]);
  if (!ws || !p || !aiAllowed(ws, p, source)) return null;
  return ctx.aiProvider;
}

export async function recordAiCall(ctx: Ctx, projectId: string, provider: string, purpose: string, inputChars: number, outputChars: number) {
  await ctx.db.query(`INSERT INTO ai_calls (id, workspace_id, project_id, provider, purpose, input_chars, output_chars) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    newId(),
    ctx.workspaceId,
    projectId,
    provider,
    purpose,
    inputChars,
    outputChars,
  ]);
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Keep only facts whose quote occurs verbatim in the document and whose value occurs in the quote. */
export function groundFacts(facts: AIExtractedFact[], pages: string[]): (AIExtractedFact & { pageIndex: number; start: number; end: number })[] {
  const out: (AIExtractedFact & { pageIndex: number; start: number; end: number })[] = [];
  for (const f of facts) {
    if (!f.quote || !f.value || f.quote.length > 500) continue;
    if (!squash(f.quote).includes(squash(f.value))) continue;
    const candidates = f.page && pages[f.page - 1] !== undefined ? [f.page - 1] : pages.map((_, i) => i);
    for (const pi of candidates) {
      const idx = pages[pi].indexOf(f.quote.trim());
      if (idx >= 0) {
        out.push({ ...f, pageIndex: pi, start: idx, end: idx + f.quote.trim().length });
        break;
      }
      if (squash(pages[pi]).includes(squash(f.quote))) {
        out.push({ ...f, pageIndex: pi, start: 0, end: 0 });
        break;
      }
    }
  }
  return out;
}

export function validateCitations(citations: string[], context: AIContextItem[]): { valid: string[]; dropped: string[] } {
  const refs = new Set(context.map((c) => c.ref));
  const valid = [...new Set(citations.filter((c) => refs.has(c)))];
  return { valid, dropped: citations.filter((c) => !refs.has(c)) };
}
