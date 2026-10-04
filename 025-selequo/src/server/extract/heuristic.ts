// Deterministic, local fact extractor (no network, no AI). Produces *candidate* facts only;
// a human confirms or rejects them. Lines flagged as prompt injection are never extracted.

import { matchLabel, type AliasRule, type CatalogAttribute, CATALOG_BY_KEY } from '../../shared/attributes';
import { normalizeValue, shapeFor, type NormalizeIssue } from '../../shared/normalize';
import { detectInjection, isOpinion } from '../../shared/textsafety';
import type { FactKind, NormalizedValue, SourceRange } from '../../shared/types';
import { toHalfWidth } from '../../shared/units';

export interface ExtractedFact {
  rawLabel: string;
  rawValue: string;
  attributeKey: string | null;
  ambiguous: string[];
  normalizedValue: NormalizedValue | null;
  unit: string | null;
  issue: NormalizeIssue;
  kind: FactKind;
  sourceRange: SourceRange;
  confidence: number;
}

export interface ExtractInput {
  /** Plain text per page. Non-paged sources pass a single page. */
  pages: string[];
  paged: boolean; // true for PDF (page numbers are cited)
  rules?: AliasRule[];
  extra?: CatalogAttribute[]; // project-defined attributes (with their aliases)
  forceOpinion?: boolean; // e.g. user-review sources
}

const PAIR_RE = /^\s*(?:[-*•・]\s*)?([^:：|\t]{1,40}?)\s*(?:[:：|\t]|\s{2,})\s*(.{1,300})$/;

// Free-text patterns: value-with-context (no explicit label)
const FREE_PATTERNS: { re: RegExp; key: string; label: string }[] = [
  { re: /(\d+(?:\.\d+)?\s*(?:GB|TB))\s*(?:の)?\s*(?:RAM|メモリ|memory|LPDDR\d\w*|DDR\d\w*)/i, key: 'memory', label: 'RAM' },
  { re: /(?:RAM|メモリ)\s*(\d+(?:\.\d+)?\s*(?:GB|TB))/i, key: 'memory', label: 'RAM' },
  { re: /(\d+(?:\.\d+)?\s*(?:GB|TB))\s*(?:の)?\s*(?:SSD|NVMe|ストレージ|storage|eMMC)/i, key: 'storage', label: 'SSD' },
  { re: /(?:約|重さ|weighs?|weight)\s*(\d+(?:\.\d+)?\s*(?:kg|g|lbs?))/i, key: 'weight', label: '重量' },
  { re: /(?:バッテリー|battery)[^\d\n]{0,12}(最大|約|up to)?\s*(\d+(?:\.\d+)?\s*(?:時間|hours?|hrs?))/i, key: 'battery_life', label: 'バッテリー' },
  { re: /(\d+(?:\.\d+)?\s*(?:インチ|型|inch(?:es)?|"))\s*(?:の)?\s*(?:ディスプレイ|display|液晶|screen)/i, key: 'display_size', label: 'ディスプレイ' },
];

function lineOffsets(page: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let pos = 0;
  for (const line of page.split('\n')) {
    out.push({ text: line, start: pos });
    pos += line.length + 1;
  }
  return out;
}

function range(paged: boolean, pageIdx: number, start: number, end: number, context: string): SourceRange {
  const ctx = context.trim().slice(0, 240);
  return paged ? { type: 'pdf', page: pageIdx + 1, start, end, context: ctx } : { type: 'text', start, end, context: ctx };
}

export function extractFacts(input: ExtractInput): { facts: ExtractedFact[]; injectionFlags: string[] } {
  const facts: ExtractedFact[] = [];
  const flags = new Set<string>();
  const seen = new Set<string>();
  input.pages.forEach((page, pageIdx) => {
    const inj = detectInjection(page);
    inj.flags.forEach((f) => flags.add(f));
    const lines = lineOffsets(page);
    lines.forEach((ln, i) => {
      if (inj.lines.has(i)) return; // never extract from injected instructions
      const line = toHalfWidth(ln.text);
      if (!line.trim() || line.length > 400) return;
      const opinion = input.forceOpinion || isOpinion(line);
      const m = line.match(PAIR_RE);
      let handled = false;
      if (m) {
        const rawLabel = m[1].trim();
        const rawValue = m[2].trim();
        if (/[\d\p{L}]/u.test(rawLabel) && rawValue && !/^https?:\/\//i.test(rawValue) && !/^https?$/i.test(rawLabel)) {
          const match = matchLabel(rawLabel, input.rules, input.extra);
          const valueStart = ln.start + ln.text.lastIndexOf(m[2].trim());
          push({
            rawLabel,
            rawValue,
            key: match.key,
            ambiguous: match.ambiguous,
            confidence: match.key ? 0.85 : 0.5,
            range: range(input.paged, pageIdx, valueStart, valueStart + rawValue.length, ln.text),
            opinion,
          });
          handled = !!match.key;
        }
      }
      if (handled) return;
      let freeHit = false;
      for (const p of FREE_PATTERNS) {
        const fm = line.match(p.re);
        if (!fm) continue;
        freeHit = true;
        const raw = (fm[2] && /\d/.test(fm[2]) ? `${fm[1] ?? ''} ${fm[2]}` : fm[1]).trim();
        const idx = ln.start + (fm.index ?? 0);
        push({ rawLabel: p.label, rawValue: raw, key: p.key, ambiguous: [], confidence: 0.6, range: range(input.paged, pageIdx, idx, idx + fm[0].length, ln.text), opinion });
      }
      // Opinions are kept as separate records (never merged into the comparison table).
      if (!freeHit && !m && opinion && line.trim().length <= 200) {
        const t = ln.text.trim();
        const at = ln.start + ln.text.indexOf(t);
        push({ rawLabel: '意見', rawValue: t, key: null, ambiguous: [], confidence: 0.5, range: range(input.paged, pageIdx, at, at + t.length, ln.text), opinion: true });
      }
    });

    function push(x: { rawLabel: string; rawValue: string; key: string | null; ambiguous: string[]; confidence: number; range: SourceRange; opinion: boolean }) {
      let normalized: NormalizedValue | null = null;
      let issue: NormalizeIssue = null;
      if (x.key) {
        const ex = input.extra?.find((a) => a.key === x.key);
        const r = normalizeValue(shapeFor(x.key, ex ? { type: ex.type, unit: ex.unit ?? null } : undefined), x.rawValue);
        normalized = r.value;
        issue = r.issue;
        // unit mismatch → the label match is likely wrong; keep the fact but unmapped for human review
        if (issue === 'unit_mismatch') x = { ...x, ambiguous: [x.key], key: null };
      }
      const dedupe = `${pageIdx}|${x.key ?? x.rawLabel.toLowerCase()}|${normalized ? JSON.stringify(normalized) : x.rawValue}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      facts.push({
        rawLabel: x.rawLabel,
        rawValue: x.rawValue,
        attributeKey: x.key,
        ambiguous: x.ambiguous,
        normalizedValue: normalized,
        unit: normalized && normalized.kind === 'number' ? normalized.unit : (x.key ? CATALOG_BY_KEY.get(x.key)?.unit ?? null : null),
        issue,
        kind: x.opinion ? 'opinion' : 'fact',
        sourceRange: x.range,
        confidence: Math.max(0.1, x.confidence - (issue ? 0.25 : 0)),
      });
    }
  });
  return { facts, injectionFlags: [...flags] };
}
