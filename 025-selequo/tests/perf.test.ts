import { describe, expect, it } from 'vitest';
import { compare, compareScenarios } from '../src/shared/compare';
import type { Fact } from '../src/shared/types';

describe('performance (pure engine)', () => {
  it('compares 20 candidates × 60 attributes × 3 sources within budget', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `Cand ${i}`, status: 'considering' as const }));
    const attributes = Array.from({ length: 60 }, (_, i) => ({ key: `a${i}`, displayName: `Attr ${i}`, type: 'number' as const, unit: 'kg', category: 'spec', groupName: null, sortOrder: i, status: 'active' as const }));
    const sources = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, quality: 'official' as const, retrievedAt: '2026-10-01T00:00:00Z', capturedAt: null, type: 'web' as const, status: 'ready' as const, title: null, url: null }));
    const facts: Fact[] = [];
    let n = 0;
    for (const c of candidates) for (const a of attributes) for (let k = 0; k < 3; k++)
      facts.push({ id: `f${n++}`, projectId: 'p', candidateId: c.id, sourceId: `s${k}`, attributeKey: a.key, rawLabel: a.key, rawValue: '1 kg', normalizedValue: { kind: 'number', value: 1 + (n % 7) / 10, unit: 'kg' }, unit: 'kg', kind: 'fact', sourceRange: { type: 'text', start: 0, end: 1, context: '' }, confidence: 0.9, reviewState: 'confirmed', extractedBy: 'parser', createdAt: '' });
    const criteria = attributes.slice(0, 15).map((a, i) => ({ id: `k${i}`, projectId: 'p', name: a.displayName, description: null, weight: 1 + (i % 5), direction: 'lower_better' as const, mustHave: false, target: null, linkedAttributes: [a.key], origin: 'user' as const, status: 'active' as const, sortOrder: i }));
    const input = { candidates, attributes, facts, criteria, prices: [], sources };
    const t0 = performance.now();
    const r = compare(input, null, { now: '2026-10-04T00:00:00Z' });
    const t1 = performance.now();
    compareScenarios(input, Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `S${i}` })), { now: '2026-10-04T00:00:00Z' });
    const t2 = performance.now();
    console.log(`facts=${facts.length} compare=${(t1 - t0).toFixed(1)}ms scenarios×5=${(t2 - t1).toFixed(1)}ms`);
    expect(r.rows).toHaveLength(60);
    expect(t1 - t0).toBeLessThan(1000);
  });
});
