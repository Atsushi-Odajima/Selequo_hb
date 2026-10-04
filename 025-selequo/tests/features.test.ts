import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLaptopSample, confirmAll, setup, fixtureUrl, type TestEnv } from './helpers';
import { MockProvider } from '../src/server/ai/provider';
import { compare } from '../src/shared/compare';
import { loadCompareInput } from '../src/server/services/comparison';

type Client = Awaited<ReturnType<TestEnv['user']>>;

describe('laptop sample: extraction → citation → normalization → compare → brief', () => {
  let env: TestEnv;
  let c: Client;
  let s: Awaited<ReturnType<typeof buildLaptopSample>>;
  const P = () => `/projects/${s.project.id}`;

  beforeAll(async () => {
    env = await setup();
    c = await env.user('sample@example.com', 'サンプル太郎');
    s = await buildLaptopSample(env, c);
  });
  afterAll(async () => env.close());

  it('creates fact *candidates* (never auto-confirmed) with citations', async () => {
    const facts = (await c.req('GET', `${P()}/facts`)).json as any[];
    expect(facts.length).toBeGreaterThan(30);
    expect(facts.every((f) => f.reviewState === 'candidate')).toBe(true);
    expect(facts.every((f) => f.sourceId && f.sourceRange)).toBe(true);
  });

  it('cites PDF page numbers', async () => {
    const facts = (await c.req('GET', `${P()}/facts?candidateId=${s.pro.id}&attributeKey=weight`)).json as any[];
    const pdfFact = facts.find((f) => f.sourceRange.type === 'pdf');
    expect(pdfFact.sourceRange.page).toBe(2);
    const ev = (await c.req('GET', `/facts/${pdfFact.id}/evidence`)).json;
    expect(ev.source.type).toBe('pdf');
    expect(ev.originalContext).toContain('Weight: 1.60 kg');
  });

  it('normalizes memory notation variants without false conflicts and keeps GPU memory separate', async () => {
    const cmp = (await c.req('GET', `${P()}/compare?factPolicy=include_unreviewed`)).json;
    const mem = cmp.rows.find((r: any) => r.attributeKey === 'memory');
    const airMem = mem.cells.find((x: any) => x.candidateId === s.air.id);
    expect(airMem.status).toBe('value'); // "16GB" (official) and "16 GB RAM (LPDDR5x)" (shop) agree
    expect(airMem.factIds.length).toBe(2);
    const storage = cmp.rows.find((r: any) => r.attributeKey === 'storage');
    expect(storage.cells.find((x: any) => x.candidateId === s.pro.id).display).toBe('1024 GB'); // 1TB = 1024GB
    const gpu = (await c.req('GET', `${P()}/facts?candidateId=${s.air.id}`)).json.find((f: any) => f.rawLabel === 'GPUメモリ');
    expect(gpu.attributeKey).toBeNull();
  });

  it('keeps conflicts with both sources (Air 14 weight official 1.18kg vs shop 1.25kg)', async () => {
    const cmp = (await c.req('GET', `${P()}/compare?factPolicy=include_unreviewed`)).json;
    const w = cmp.rows.find((r: any) => r.attributeKey === 'weight').cells.find((x: any) => x.candidateId === s.air.id);
    expect(w.status).toBe('conflict');
    expect(w.values.map((v: any) => v.display)).toEqual(['1.18 kg', '1.25 kg']);
    const missing = (await c.req('GET', `${P()}/missing`)).json;
    expect(missing.conflicts).toHaveLength(1);
  });

  it('shows Unknown (not 0) for missing battery life of Lite 15', async () => {
    const cmp = (await c.req('GET', `${P()}/compare?factPolicy=include_unreviewed`)).json;
    const b = cmp.rows.find((r: any) => r.attributeKey === 'battery_life').cells.find((x: any) => x.candidateId === s.lite.id);
    expect(b.status).toBe('unknown');
    expect(b.display).toBe('Unknown');
    expect(b.values).toEqual([]);
  });

  it('separates opinions from facts and flags prompt injection without obeying it', async () => {
    const facts = (await c.req('GET', `${P()}/facts`)).json as any[];
    const opinions = facts.filter((f) => f.kind === 'opinion');
    expect(opinions.length).toBeGreaterThanOrEqual(2);
    const cmp = (await c.req('GET', `${P()}/compare?factPolicy=include_unreviewed`)).json;
    const allFactIds = cmp.rows.flatMap((r: any) => r.cells.flatMap((x: any) => x.factIds));
    expect(opinions.some((o) => allFactIds.includes(o.id))).toBe(false);
    const sources = (await c.req('GET', `${P()}/sources`)).json as any[];
    const shopLite = sources.find((x) => x.url?.includes('shop') && x.url.includes('lite15'));
    expect(shopLite.injectionFlags).toContain('ignore-previous-instructions');
    expect(facts.some((f) => /ignore previous/i.test(f.rawValue + f.rawLabel))).toBe(false);
    const cands = (await c.req('GET', `${P()}/candidates`)).json as any[];
    expect(cands.every((x) => x.status === 'considering')).toBe(true);
  });

  it('confirm / reject with rules: opinion cannot be confirmed; deleted-source facts cannot be confirmed', async () => {
    const facts = (await c.req('GET', `${P()}/facts`)).json as any[];
    const opinion = facts.find((f) => f.kind === 'opinion');
    expect((await c.req('POST', `/facts/${opinion.id}/review`, { action: 'confirm' })).status).toBe(400);
    const anyFact = facts.find((f) => f.attributeKey === 'os' && f.candidateId === s.pro.id);
    const r1 = (await c.req('POST', `/facts/${anyFact.id}/review`, { action: 'confirm' })).json;
    expect(r1.reviewState).toBe('confirmed');
    const r2 = (await c.req('POST', `/facts/${anyFact.id}/review`, { action: 'reject', note: 'テスト' })).json;
    expect(r2.reviewState).toBe('rejected');
    await c.req('POST', `/facts/${anyFact.id}/review`, { action: 'reopen' });
    const audit = (await c.req('GET', `/audit?projectId=${s.project.id}`)).json as any[];
    expect(audit.filter((a) => a.entityId === anyFact.id).map((a) => a.action)).toEqual(expect.arrayContaining(['fact.confirm', 'fact.reject', 'fact.reopen']));
  });

  it('relates a phone screenshot to a candidate and cites an image region (PC evidence review)', async () => {
    const sources = (await c.req('GET', `${P()}/sources`)).json as any[];
    const shot = sources.find((x) => x.type === 'screenshot');
    expect(shot.candidateId).toBe(s.lite.id);
    expect(shot.capturedAt).toBeTruthy();
    const f = (await c.req('POST', `${P()}/facts`, { candidateId: s.lite.id, attributeKey: 'price', label: 'セール価格', value: '¥127,600（税込）', sourceId: shot.id, region: { x: 0.05, y: 0.2, w: 0.6, h: 0.15 } })).json;
    expect(f.sourceRange).toMatchObject({ type: 'image', region: { x: 0.05 } });
    const ev = (await c.req('GET', `/facts/${f.id}/evidence`)).json;
    expect(ev.source.type).toBe('screenshot');
    expect(ev.source.fileUrl).toMatch(/^\/api\/files\?key=/);
    const file = await env.app.inject({ method: 'GET', url: ev.source.fileUrl });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
  });

  it('keeps price snapshots with timestamps (history) and separates tax mode', async () => {
    const prices = (await c.req('GET', `${P()}/prices`)).json as any[];
    const lite = prices.filter((p) => p.candidateId === s.lite.id);
    expect(lite.length).toBeGreaterThanOrEqual(2); // shop page + screenshot
    expect(lite.every((p) => p.capturedAt)).toBe(true);
    expect(lite.find((p) => p.amount === 127600)?.tax).toBe('included');
    const official = prices.find((p) => p.candidateId === s.air.id && p.amount === 148000);
    expect(official.tax).toBe('unknown');
    // FX requires source + time
    const bad = await c.req('POST', `${P()}/prices`, { candidateId: s.pro.id, amount: 1299, currency: 'USD', fxRate: 150, fxBase: 'JPY' });
    expect(bad.status).toBe(400);
    const ok = await c.req('POST', `${P()}/prices`, { candidateId: s.pro.id, amount: 1299, currency: 'USD', fxRate: 150, fxBase: 'JPY', fxSource: '手入力（テスト）', fxAt: '2026-10-01T00:00:00Z' });
    expect(ok.status).toBe(200);
  });

  it('criteria, must-have Unknown (not Fail), weighted scores with coverage; scenarios change results', async () => {
    await confirmAll(c, s.project.id);
    // resolve the Air weight conflict: keep official
    const wf = (await c.req('GET', `${P()}/facts?candidateId=${s.air.id}&attributeKey=weight`)).json as any[];
    const official = wf.find((f) => f.rawValue.includes('1.18'));
    const shop = wf.find((f) => f.rawValue.includes('1.25'));
    // after bulk-confirm both are confirmed → still a conflict (kept, not silently dropped)
    let cmp = (await c.req('GET', `${P()}/compare`)).json;
    expect(cmp.conflicts).toHaveLength(1);
    await c.req('POST', `${P()}/conflicts/resolve`, { keepFactId: official.id, supersedeFactIds: [shop.id], note: '公式値を採用' });
    const shopAfter = (await c.req('GET', `/facts/${shop.id}/evidence`)).json;
    expect(shopAfter.fact.reviewState).toBe('superseded');
    expect(shopAfter.fact.supersededBy).toBe(official.id);

    const weight = (await c.req('POST', `${P()}/criteria`, { name: '軽さ', weight: 3, direction: 'lower_better', linkedAttributes: ['weight'] })).json;
    const battery = (await c.req('POST', `${P()}/criteria`, { name: 'バッテリー', weight: 2, direction: 'higher_better', linkedAttributes: ['battery_life'], mustHave: true, target: { op: '>=', value: 8, unit: 'h' } })).json;
    const mem = (await c.req('POST', `${P()}/criteria`, { name: 'メモリ', weight: 1, direction: 'higher_better', linkedAttributes: ['memory'] })).json;
    const price = (await c.req('POST', `${P()}/criteria`, { name: '価格', weight: 2, direction: 'lower_better', linkedAttributes: ['price'] })).json;

    cmp = (await c.req('GET', `${P()}/compare`)).json;
    const bEval = cmp.criteria.find((x: any) => x.criterionId === battery.id);
    expect(bEval.perCandidate.find((p: any) => p.candidateId === s.lite.id).mustHave).toBe('unknown'); // Unknown ≠ Fail
    expect(bEval.perCandidate.find((p: any) => p.candidateId === s.air.id).mustHave).toBe('pass');
    const liteScore = cmp.scores.find((x: any) => x.candidateId === s.lite.id);
    expect(liteScore.coverage).toBeLessThan(1);
    expect(liteScore.range[0]).toBeLessThan(liteScore.range[1]);
    expect(liteScore.mustHave.status).toBe('unknown');
    expect(cmp.statement).toMatch(/このCriteria設定では/);
    expect(cmp.statement).not.toMatch(/winner|勝者|おすすめ|ベスト/i);
    expect(cmp.formula.join('\n')).toContain('Σ');

    // weight validation
    expect((await c.req('POST', `${P()}/criteria`, { name: 'bad', weight: -1, linkedAttributes: [] })).status).toBe(400);
    expect((await c.req('PUT', `${P()}/weights`, { [weight.id]: 0, [battery.id]: 0, [mem.id]: 0, [price.id]: 0 })).status).toBe(400);
    expect((await c.req('PUT', `${P()}/weights`, { [weight.id]: 150 })).status).toBe(400);

    // scenarios
    const travel = (await c.req('POST', `${P()}/scenarios`, { name: 'Travel', weights: { [weight.id]: 10, [battery.id]: 8, [mem.id]: 1, [price.id]: 1 } })).json;
    const perf = (await c.req('POST', `${P()}/scenarios`, { name: 'Performance', weights: { [weight.id]: 0, [battery.id]: 1, [mem.id]: 10, [price.id]: 0 } })).json;
    const budget = (await c.req('POST', `${P()}/scenarios`, { name: 'Budget', weights: { [weight.id]: 1, [battery.id]: 0, [mem.id]: 1, [price.id]: 10 }, mustHaves: { [battery.id]: false } })).json;
    expect((await c.req('POST', `${P()}/scenarios`, { name: 'bad', weights: { [weight.id]: -5 } })).status).toBe(400);
    const matrix = (await c.req('GET', `${P()}/scenario-matrix`)).json;
    const top = (name: string) => matrix.scenarios.find((x: any) => x.name === name).topCandidateIds;
    expect(top('Travel')).toEqual([s.air.id]);
    expect(top('Performance')).toEqual([s.pro.id]);
    expect(top('Budget')).toEqual([s.lite.id]);
    expect(matrix.resultsDiffer).toBe(true);
    expect(travel.id && perf.id && budget.id).toBeTruthy();
    // audit of criteria/weights/scenarios
    const audit = (await c.req('GET', `/audit?projectId=${s.project.id}`)).json as any[];
    for (const a of ['criterion.create', 'criterion.create_must_have', 'scenario.create', 'conflict.resolve', 'fact.supersede']) expect(audit.some((x) => x.action === a), a).toBe(true);
  });

  it('scores are reproducible (same input → same output)', async () => {
    const ctx = { ...env.deps, workspaceId: c.ws, role: 'owner' as const, scopes: ['read' as const], actor: { type: 'system' as const, userId: null, name: 's' } };
    const { input } = await loadCompareInput(ctx, s.project.id);
    const a = compare(input, null, { now: '2026-10-04T00:00:00Z', currency: 'JPY' });
    const b = compare(JSON.parse(JSON.stringify(input)), null, { now: '2026-10-04T00:00:00Z', currency: 'JPY' });
    expect(b).toEqual(a);
    expect(a.formulaVersion).toBe('v1');
  });

  it('research assistant answers with citations (AI OFF → deterministic presets)', async () => {
    const r = (await c.req('POST', `${P()}/assistant`, { preset: 'big_differences', candidateIds: [s.air.id, s.pro.id] })).json;
    expect(r.usedAI).toBe(false);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.some((i: any) => i.citations.length > 0)).toBe(true);
    const miss = (await c.req('POST', `${P()}/assistant`, { preset: 'missing' })).json;
    expect(miss.answer).toContain('Arcfield Lite 15');
    const noOfficial = (await c.req('POST', `${P()}/assistant`, { preset: 'no_official_source' })).json;
    expect(noOfficial.items.length).toBeGreaterThan(0);
    const weak = (await c.req('POST', `${P()}/assistant`, { preset: 'weaknesses_besides_price' })).json;
    expect(weak.answer).toContain('Unknown');
    const free = (await c.req('POST', `${P()}/assistant`, { question: '重量はどれくらい？' })).json;
    expect(free.usedAI).toBe(false);
    expect(free.citations.length).toBeGreaterThan(0);
  });

  it('questions are linked to candidates with status / answer / source', async () => {
    const q = (await c.req('POST', `${P()}/questions`, { text: 'Lite 15のバッテリー駆動時間は？', candidateId: s.lite.id, attributeKey: 'battery_life' })).json;
    expect(q.status).toBe('open');
    const src = (await c.req('POST', `${P()}/sources/text`, { text: 'Arcfield Lite 15 サポート回答\nバッテリー駆動時間: 最大9時間', candidateId: s.lite.id, quality: 'vendor', title: 'サポート窓口の回答' })).json;
    await env.runner.drain();
    const fact = (await c.req('GET', `${P()}/facts?candidateId=${s.lite.id}&attributeKey=battery_life`)).json[0];
    const a = (await c.req('PATCH', `/questions/${q.id}`, { answer: '最大9時間（サポート回答）', answerSourceId: src.id, answerFactId: fact.id })).json;
    expect(a.status).toBe('answered');
    // must-have Unknown → after the additional source and confirmation → Pass
    await c.req('POST', `/facts/${fact.id}/review`, { action: 'confirm' });
    const cmp = (await c.req('GET', `${P()}/compare`)).json;
    const bat = cmp.criteria.find((x: any) => x.name === 'バッテリー');
    expect(bat.perCandidate.find((p: any) => p.candidateId === s.lite.id).mustHave).toBe('pass');
  });

  it('decision record: human decides, AI never marked as decider; review after 90 days', async () => {
    const tok = (await c.req('POST', '/tokens', { name: 'mcp', scopes: ['read', 'write'] })).json.token;
    const t = new env.Client();
    t.bearer = tok;
    t.ws = c.ws;
    // API tokens cannot finalize a decision or set "chosen"
    expect((await t.req('PUT', `${P()}/decision`, { chosenCandidateId: s.air.id, reason: 'x', finalize: true })).status).toBe(400);
    expect((await t.req('PATCH', `/candidates/${s.air.id}`, { status: 'chosen' })).status).toBe(400);
    const d = (await c.req('PUT', `${P()}/decision`, { chosenCandidateId: s.air.id, reason: '出張が多く軽さとバッテリーを優先', assumptions: '月4回以上の出張', expectedOutcome: '移動中も作業できる', reviewInDays: 90, finalize: true })).json;
    expect(d.status).toBe('decided');
    expect(d.decidedByName).toBe('サンプル太郎');
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    expect(d.reviewDate).toBe(in90);
    const cands = (await c.req('GET', `${P()}/candidates`)).json as any[];
    expect(cands.find((x) => x.id === s.air.id).status).toBe('chosen');
    expect((await c.req('GET', '/reviews/due')).json).toHaveLength(0);
    const r = (await c.req('POST', `${P()}/decision/review`, { actualResult: '想定通り軽量で満足', lessons: '重量は公式値と販売店値が異なることがある' })).json;
    expect(r.status).toBe('reviewed');
  });

  it('decision brief contains all sections with citations and exports to md/html/txt/json/pdf', async () => {
    const brief = (await c.req('POST', `${P()}/briefs`)).json;
    const b = brief.content;
    expect(b.schema).toBe('selequo.brief/v1');
    expect(b.keyDifferences.length).toBeGreaterThan(0);
    expect(b.evidence.length).toBeGreaterThan(0);
    expect(b.keyDifferences.some((k: any) => k.values.some((v: any) => v.cites.length))).toBe(true);
    expect(b.scenarioResults.length).toBe(4);
    expect(b.decision.chosen).toBe('Arcfield Air 14');
    expect(b.decision.decidedBy).toBe('サンプル太郎');
    expect(b.disclaimer).toContain('AIが候補を決定したものではありません');
    for (const f of ['md', 'html', 'txt', 'json']) {
      const r = await c.req('GET', `${P()}/brief/export?format=${f}&briefId=${brief.id}`);
      expect(r.status, f).toBe(200);
      const text = r.body.toString();
      expect(text).toContain('Arcfield');
      expect(text).not.toMatch(/AIが(決定|選びました)/);
    }
    const pdf = await c.req('GET', `${P()}/brief/export?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60000);

  it('escapes user content in HTML brief (XSS) and neutralizes CSV formulas', async () => {
    const x = (await c.req('POST', `${P()}/candidates`, { name: '<img src=x onerror=alert(1)>' })).json;
    await c.req('POST', `${P()}/facts`, { candidateId: x.id, attributeKey: 'os', value: '=HYPERLINK("http://evil")' });
    const html = (await c.req('GET', `${P()}/brief/export?format=html`)).body.toString();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    const csv = (await c.req('GET', `${P()}/compare.csv`)).body.toString();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")`);
    await c.req('DELETE', `/candidates/${x.id}`);
  });

  it('deleting a source removes file, facts and search index entries', async () => {
    const before = (await c.req('GET', `/search?q=${encodeURIComponent('AF-P16-2026')}`)).json as any[];
    expect(before.length).toBeGreaterThan(0);
    const sources = (await c.req('GET', `${P()}/sources`)).json as any[];
    const pdf = sources.find((x) => x.type === 'pdf');
    const fileUrl = pdf.fileUrl;
    expect((await c.req('DELETE', `/sources/${pdf.id}`)).status).toBe(200);
    const after = (await c.req('GET', `/search?q=${encodeURIComponent('AF-P16-2026')}`)).json as any[];
    expect(after).toHaveLength(0);
    expect((await c.req('GET', `${P()}/facts?sourceId=${pdf.id}`)).json).toHaveLength(0);
    expect((await env.app.inject({ method: 'GET', url: fileUrl })).statusCode).toBe(404);
    const row = await env.db.one(`SELECT extracted_text, file_key FROM sources WHERE id = $1`, [pdf.id]);
    expect(row?.extracted_text).toBeNull();
    expect(row?.file_key).toBeNull();
  });

  it('export → import a project and backup → restore into an empty environment with identical relations', async () => {
    const exp = (await c.req('GET', `${P()}/export.json`)).json;
    const imp = (await c.req('POST', '/projects/import', exp)).json;
    const facts1 = (await c.req('GET', `${P()}/facts`)).json as any[];
    const facts2 = (await c.req('GET', `/projects/${imp.projectId}/facts`)).json as any[];
    expect(facts2.length).toBe(facts1.length);

    const zip = await c.req('GET', '/backup');
    expect(zip.status).toBe(200);
    // brand-new environment
    const env2 = await setup();
    const u2 = await env2.user('restore@example.com');
    const boundary = '----r' + Date.now();
    const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.zip"\r\nContent-Type: application/zip\r\n\r\n`), zip.body, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const res = await u2.req('POST', '/api/restore', undefined, { raw, contentType: `multipart/form-data; boundary=${boundary}` });
    expect(res.status).toBe(200);
    const r2 = env2.inWs(u2, res.json.workspaceId);
    const projects1 = (await c.req('GET', '/projects')).json as any[];
    const projects2 = (await r2.req('GET', '/projects')).json as any[];
    expect(projects2.map((p) => p.title).sort()).toEqual(projects1.map((p) => p.title).sort());
    // relation signature: candidate name → attribute → fact values with source titles
    const signature = async (cl: any, pid: string) => {
      const cands = (await cl.req('GET', `/projects/${pid}/candidates`)).json as any[];
      const srcs = (await cl.req('GET', `/projects/${pid}/sources`)).json as any[];
      const fs = (await cl.req('GET', `/projects/${pid}/facts`)).json as any[];
      const crit = (await cl.req('GET', `/projects/${pid}/criteria`)).json as any[];
      const scen = (await cl.req('GET', `/projects/${pid}/scenarios`)).json as any[];
      const cn = new Map(cands.map((x) => [x.id, x.name]));
      const sn = new Map(srcs.map((x) => [x.id, x.title]));
      const crn = new Map(crit.map((x) => [x.id, x.name]));
      return {
        facts: fs.map((f) => `${cn.get(f.candidateId)}|${f.attributeKey}|${f.rawValue}|${sn.get(f.sourceId)}|${f.reviewState}|${f.supersededBy ? 'sup' : ''}`).sort(),
        scenarios: scen.map((x) => `${x.name}:${Object.entries(x.weights).map(([k, v]) => `${crn.get(k)}=${v}`).sort().join(',')}`).sort(),
        cmp: (await cl.req('GET', `/projects/${pid}/compare`)).json.scores.map((x: any) => `${x.name}:${x.score}:${x.coverage}`).sort(),
      };
    };
    const orig = projects1.find((p) => p.id === s.project.id);
    const restored = projects2.find((p) => p.title === orig.title);
    expect(await signature(r2, restored.id)).toEqual(await signature(c, s.project.id));
    // files restored and served
    const srcs2 = (await r2.req('GET', `/projects/${restored.id}/sources`)).json as any[];
    const shot = srcs2.find((x) => x.type === 'screenshot');
    expect((await env2.app.inject({ method: 'GET', url: shot.fileUrl })).statusCode).toBe(200);
    // decision restored
    expect((await r2.req('GET', `/projects/${restored.id}/decision`)).json.status).toBe('reviewed');
    await env2.close();
  }, 60000);
});

describe('AI provider guard', () => {
  it('AI OFF → zero provider calls (workspace or project switch)', async () => {
    const mock = new MockProvider();
    const env = await setup({ ai: mock });
    const c = await env.user('aioff@example.com');
    const p = (await c.req('POST', '/projects', { title: 'AI OFF', aiEnabled: false })).json;
    const cand = (await c.req('POST', `/projects/${p.id}/candidates`, { name: 'Alpha' })).json;
    await c.req('POST', `/projects/${p.id}/sources/url`, { url: fixtureUrl('saas', 'alpha.html'), candidateId: cand.id });
    await c.upload(p.id, 'fixtures/sample/raw/lite15-screenshot.png', { candidateId: cand.id, kind: 'screenshot' });
    await env.runner.drain();
    await c.req('POST', `/projects/${p.id}/assistant`, { question: 'SSOは？' });
    expect(mock.calls).toHaveLength(0);
    expect((await c.req('GET', `/ai-usage?projectId=${p.id}`)).json.usage).toHaveLength(0);
    // turning AI on for the project uses the provider; workspace OFF overrides it again
    await c.req('PATCH', `/projects/${p.id}`, { aiEnabled: true });
    await c.req('POST', `/projects/${p.id}/assistant`, { question: 'SSOは？' });
    expect(mock.calls.length).toBe(1);
    await c.req('PATCH', '', { aiEnabled: false });
    await c.req('POST', `/projects/${p.id}/assistant`, { question: 'SSOは？' });
    expect(mock.calls.length).toBe(1);
    // per-source AI OFF
    await c.req('PATCH', '', { aiEnabled: true });
    await c.req('POST', `/projects/${p.id}/sources/text`, { text: 'SSO: 対応', candidateId: cand.id, aiEnabled: false });
    await env.runner.drain();
    expect(mock.calls.filter((x) => x.kind === 'extract')).toHaveLength(0);
    await env.close();
  });

  it('AI facts are candidates, must be grounded in the document; fake citations are dropped', async () => {
    const mock = new MockProvider('adversarial');
    const env = await setup({ ai: mock });
    const c = await env.user('ai@example.com');
    const p = (await c.req('POST', '/projects', { title: 'AI' })).json;
    const cand = (await c.req('POST', `/projects/${p.id}/candidates`, { name: 'Alpha' })).json;
    await c.req('POST', `/projects/${p.id}/sources/text`, { text: '保証 => 3年\nメモリ: 8GB', candidateId: cand.id });
    await env.runner.drain();
    const facts = (await c.req('GET', `/projects/${p.id}/facts`)).json as any[];
    const ai = facts.filter((f) => f.extractedBy.startsWith('ai:'));
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((f) => f.reviewState === 'candidate')).toBe(true);
    expect(facts.some((f) => f.rawValue.includes('128GB'))).toBe(false); // hallucination dropped by grounding
    const ans = (await c.req('POST', `/projects/${p.id}/assistant`, { question: 'メモリは？' })).json;
    expect(ans.usedAI).toBe(true);
    expect(ans.droppedCitations).toContain('F:does-not-exist');
    expect(ans.citations.every((x: any) => facts.some((f) => f.id === x.factId))).toBe(true);
    await env.close();
  });
});

describe('SaaS: monthly / annual / seats', () => {
  it('does not mix monthly and annual prices; scenario seats change annual cost', async () => {
    const env = await setup();
    const c = await env.user('saas@example.com');
    const p = (await c.req('POST', '/projects', { title: 'SaaS選定', category: 'saas', defaultParams: { seats: 10, costBasis: 'annual_total' } })).json;
    const ids: Record<string, string> = {};
    for (const n of ['alpha', 'beta', 'gamma']) {
      ids[n] = (await c.req('POST', `/projects/${p.id}/candidates`, { name: n })).json.id;
      await c.req('POST', `/projects/${p.id}/sources/url`, { url: fixtureUrl('saas', `${n}.html`), candidateId: ids[n], quality: 'official' });
    }
    await env.runner.drain();
    await confirmAll(c, p.id);
    const cmp0 = (await c.req('GET', `/projects/${p.id}/compare`)).json;
    const priceRow = cmp0.rows.find((r: any) => r.attributeKey === 'price');
    const alpha = priceRow.cells.find((x: any) => x.candidateId === ids.alpha);
    expect(alpha.status).toBe('value'); // monthly + annual are different offers, not a conflict
    expect(alpha.values.map((v: any) => v.display).sort()).toEqual(['¥1,200/月/席', '¥12,000/年/席']);
    const cost = (await c.req('POST', `/projects/${p.id}/criteria`, { name: '年間コスト', weight: 5, direction: 'lower_better', linkedAttributes: ['price'] })).json;
    const sso = (await c.req('POST', `/projects/${p.id}/criteria`, { name: 'SSO', weight: 3, direction: 'boolean', linkedAttributes: ['sso'], mustHave: true })).json;
    const small = (await c.req('POST', `/projects/${p.id}/scenarios`, { name: 'Small Team', weights: { [cost.id]: 10, [sso.id]: 0 }, mustHaves: { [sso.id]: false }, params: { seats: 5 } })).json;
    const ent = (await c.req('POST', `/projects/${p.id}/scenarios`, { name: 'Enterprise Security', weights: { [cost.id]: 1, [sso.id]: 10 }, params: { seats: 40 } })).json;
    const small5 = (await c.req('GET', `/projects/${p.id}/compare?scenarioId=${small.id}`)).json;
    const costEval = small5.criteria.find((x: any) => x.criterionId === cost.id);
    const a = costEval.perCandidate.find((x: any) => x.candidateId === ids.alpha);
    expect(a.input).toBe(60000); // annual plan 12,000 × 5 seats is cheaper than monthly 1,200 × 12 × 5 = 72,000
    expect(a.costSteps.join(' ')).toContain('× 5席');
    const b = costEval.perCandidate.find((x: any) => x.candidateId === ids.beta);
    expect(b.input).toBe(58800); // 980 × 5 × 12 (stated)
    expect(b.costSteps.join(' ')).toContain('月額 × 12ヶ月');
    const g = costEval.perCandidate.find((x: any) => x.candidateId === ids.gamma);
    expect(g.input).toBe(150000);
    expect(small5.scores.find((x: any) => x.rank === 1).candidateId).toBe(ids.beta);
    const entR = (await c.req('GET', `/projects/${p.id}/compare?scenarioId=${ent.id}`)).json;
    expect(entR.scores.find((x: any) => x.candidateId === ids.beta).mustHave.status).toBe('fail');
    expect(entR.scores.find((x: any) => x.rank === 1).candidateId).not.toBe(ids.beta);
    await env.close();
  });
});
