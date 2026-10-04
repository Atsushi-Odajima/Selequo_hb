// MCP tool definitions. Every tool runs with the caller's API-token context (workspace-scoped,
// role-capped, read/write scopes). There is deliberately NO tool that chooses or decides a candidate.

import { z } from 'zod';
import type { Ctx } from '../server/services/core';
import * as P from '../server/services/projects';
import * as S from '../server/services/sources';
import * as F from '../server/services/facts';
import * as C from '../server/services/comparison';
import * as D from '../server/services/decisions';
import * as Q from '../server/services/assistant';
import { briefToMarkdown } from '../shared/brief';
import { search } from '../server/services/search';

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  write: boolean;
  input: z.ZodRawShape;
  run: (ctx: Ctx, args: any) => Promise<unknown>;
}

const pid = { projectId: z.string().describe('Comparison project id') };

export const TOOLS: ToolDef[] = [
  {
    name: 'search_comparisons',
    title: 'Search comparisons',
    description: 'Full-text search across projects, candidates, sources, facts, questions and decisions in this workspace.',
    write: false,
    input: { query: z.string().min(1).max(200), projectId: z.string().optional() },
    run: (ctx, a) => search(ctx, a.query, { projectId: a.projectId }),
  },
  {
    name: 'create_comparison',
    title: 'Create comparison project',
    description: 'Create a new comparison project (title, purpose, category such as laptop or saas).',
    write: true,
    input: { title: z.string().min(1).max(120), purpose: z.string().max(2000).optional(), category: z.string().max(60).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() },
    run: (ctx, a) => P.createProject(ctx, P.ProjectInput.parse(a)),
  },
  {
    name: 'add_candidate',
    title: 'Add candidate',
    description: 'Add a candidate (product, vendor, plan...) to a comparison. Candidates start as "considering"; they are never auto-chosen.',
    write: true,
    input: { ...pid, name: z.string().min(1).max(120), provider: z.string().max(120).optional(), url: z.string().url().optional() },
    run: (ctx, a) => P.createCandidate(ctx, a.projectId, P.CandidateInput.parse({ name: a.name, provider: a.provider, url: a.url })),
  },
  {
    name: 'add_source',
    title: 'Add source',
    description: 'Add a source to a candidate: a public URL (fetched politely, robots.txt respected) or pasted text. Extracted facts become review candidates.',
    write: true,
    input: { ...pid, candidateId: z.string(), url: z.string().url().optional(), text: z.string().max(200000).optional(), title: z.string().max(300).optional(), quality: z.enum(['official', 'manufacturer', 'vendor', 'marketplace', 'editorial', 'user_review', 'manual', 'unknown']).optional() },
    run: async (ctx, a) => {
      if (a.url) return S.addUrlSource(ctx, a.projectId, S.UrlSourceInput.parse({ url: a.url, candidateId: a.candidateId, quality: a.quality, title: a.title }));
      if (a.text) return S.addTextSource(ctx, a.projectId, S.TextSourceInput.parse({ text: a.text, candidateId: a.candidateId, quality: a.quality, title: a.title }));
      throw new Error('url または text を指定してください');
    },
  },
  {
    name: 'get_compare_table',
    title: 'Get comparison table',
    description: 'Candidate × attribute comparison table with Unknown/Conflict cells, source age and fact ids. Scores are "under the given criteria" only.',
    write: false,
    input: { ...pid, scenarioId: z.string().optional() },
    run: async (ctx, a) => {
      const r = await C.getCompare(ctx, a.projectId, { scenarioId: a.scenarioId });
      return {
        candidates: r.candidates.map((c) => ({ id: c.id, name: c.name })),
        rows: r.rows.map((row) => ({ attribute: row.displayName, key: row.attributeKey, differs: row.differs, cells: row.cells.map((c) => ({ candidateId: c.candidateId, status: c.status, value: c.display, verified: c.verified, factIds: c.factIds, sourceAgeDays: c.sourceAgeDays })) })),
        scores: r.scores,
        statement: r.statement,
        caveats: r.caveats,
      };
    },
  },
  {
    name: 'get_missing_information',
    title: 'Get missing information',
    description: 'Unknown cells (Unknown ≠ 0), must-have criteria that are Unknown, unconfirmed values and open questions.',
    write: false,
    input: pid,
    run: (ctx, a) => C.getMissing(ctx, a.projectId),
  },
  {
    name: 'get_conflicts',
    title: 'Get conflicts',
    description: 'Attributes where sources disagree. Both values are kept with their citations.',
    write: false,
    input: pid,
    run: async (ctx, a) => {
      const m = await C.getMissing(ctx, a.projectId);
      const ev = await Promise.all(m.conflicts.flatMap((c) => c.factIds).map((id) => F.getEvidence(ctx, id)));
      return m.conflicts.map((c) => ({
        ...c,
        evidence: ev.filter((e) => c.factIds.includes(e.fact.id)).map((e) => ({ factId: e.fact.id, value: e.fact.rawValue, source: (e.source as any).title ?? (e.source as any).url, quality: (e.source as any).quality, retrievedAt: (e.source as any).retrievedAt })),
      }));
    },
  },
  {
    name: 'set_criteria',
    title: 'Set criteria',
    description: 'Create a criterion with weight (0-100), direction, optional must-have target, linked attributes. The user decides weights; this tool only records them.',
    write: true,
    input: {
      ...pid,
      name: z.string().min(1).max(80),
      weight: z.number().min(0).max(100),
      direction: z.enum(['higher_better', 'lower_better', 'target', 'boolean', 'none']),
      linkedAttributes: z.array(z.string()).max(10),
      mustHave: z.boolean().optional(),
      target: z.object({ op: z.enum(['>=', '<=', '=', '>', '<', 'includes']), value: z.union([z.number(), z.string(), z.boolean()]), unit: z.string().optional() }).optional(),
    },
    run: (ctx, a) => P.createCriterion(ctx, a.projectId, { name: a.name, weight: a.weight, direction: a.direction, linkedAttributes: a.linkedAttributes, mustHave: a.mustHave ?? false, target: a.target ?? null }),
  },
  {
    name: 'compare_scenarios',
    title: 'Compare scenarios',
    description: 'Scores per scenario (different weights / must-haves / seats). Shows whether results change with conditions. Never declares a winner.',
    write: false,
    input: pid,
    run: (ctx, a) => C.getScenarioMatrix(ctx, a.projectId),
  },
  {
    name: 'get_evidence',
    title: 'Get evidence',
    description: 'Evidence for a fact: value, source (URL/PDF page/screenshot region/manual author), captured date, original context, confidence, review state, conflicts.',
    write: false,
    input: { factId: z.string() },
    run: async (ctx, a) => {
      const e = await F.getEvidence(ctx, a.factId);
      const src = e.source as Record<string, any>;
      return { fact: e.fact, source: { ...src, fileKey: undefined }, originalContext: e.originalContext, conflict: e.conflict, siblings: e.siblings.map((s) => ({ id: s.id, value: s.rawValue, state: s.reviewState })) };
    },
  },
  {
    name: 'ask_research_assistant',
    title: 'Ask research assistant',
    description: 'Ask about the comparison. Presets: big_differences, missing, no_official_source, weaknesses_besides_price, conflicts. Answers include citations.',
    write: false,
    input: { ...pid, preset: z.enum(['big_differences', 'missing', 'no_official_source', 'weaknesses_besides_price', 'conflicts']).optional(), question: z.string().max(1000).optional() },
    run: (ctx, a) => Q.ask(ctx, a.projectId, { preset: a.preset, question: a.question }),
  },
  {
    name: 'generate_decision_brief',
    title: 'Generate decision brief',
    description: 'Generate a cited Decision Brief (Markdown) and save it as a new version. The brief records the human decision if one exists; it never makes one.',
    write: true,
    input: pid,
    run: async (ctx, a) => {
      const b = await D.createBriefVersion(ctx, a.projectId);
      return { briefId: b.id, version: b.version, markdown: briefToMarkdown(b.content) };
    },
  },
];

/** Names that must never exist (automatic decision tools are prohibited). */
export const FORBIDDEN_TOOL_PATTERNS = [/choose/i, /decide/i, /select_winner/i, /pick/i, /winner/i];
