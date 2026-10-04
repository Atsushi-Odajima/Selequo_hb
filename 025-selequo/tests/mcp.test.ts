import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLaptopSample, setup, type TestEnv } from './helpers';
import { FORBIDDEN_TOOL_PATTERNS, TOOLS } from '../src/mcp/tools';

describe('MCP server (Streamable HTTP)', () => {
  let env: TestEnv;
  let readTok: string;
  let writeTok: string;
  let projectId: string;
  let otherWsTok: string;
  let candidateId: string;
  let s: Awaited<ReturnType<typeof buildLaptopSample>>;

  const rpc = async (token: string | null, method: string, params: unknown = {}, id = 1) => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload: { jsonrpc: '2.0', id, method, params },
    });
    return { status: res.statusCode, json: res.statusCode === 200 ? res.json() : res.json?.() };
  };
  const call = async (token: string, name: string, args: Record<string, unknown>) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    const content = r.json.result?.content?.[0]?.text ?? '';
    return { isError: !!r.json.result?.isError, text: content, data: (() => { try { return JSON.parse(content); } catch { return null; } })() };
  };

  beforeAll(async () => {
    env = await setup();
    const c = await env.user('mcp@example.com');
    s = await buildLaptopSample(env, c);
    projectId = s.project.id;
    candidateId = s.lite.id;
    readTok = (await c.req('POST', '/tokens', { name: 'read', scopes: ['read'] })).json.token;
    writeTok = (await c.req('POST', '/tokens', { name: 'write', scopes: ['read', 'write'] })).json.token;
    const other = await env.user('mcp-other@example.com');
    otherWsTok = (await other.req('POST', '/tokens', { name: 'other', scopes: ['read', 'write'] })).json.token;
  });
  afterAll(async () => env.close());

  it('requires a bearer token', async () => {
    const r = await rpc(null, 'tools/list');
    expect(r.status).toBe(401);
    expect((await rpc('slq_invalid', 'tools/list')).status).toBe(401);
  });

  it('lists the documented tools and no automatic decision tool', async () => {
    await rpc(readTok, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const r = await rpc(readTok, 'tools/list');
    const names = r.json.result.tools.map((t: { name: string }) => t.name);
    for (const n of ['create_comparison', 'add_candidate', 'add_source', 'get_compare_table', 'get_missing_information', 'get_conflicts', 'set_criteria', 'compare_scenarios', 'get_evidence', 'generate_decision_brief', 'search_comparisons']) expect(names).toContain(n);
    expect(names.some((n: string) => FORBIDDEN_TOOL_PATTERNS.some((re) => re.test(n)))).toBe(false);
    expect(TOOLS.some((t) => /choose_candidate/.test(t.name))).toBe(false);
  });

  it('answers "missing information" with Unknown cells and citations via evidence', async () => {
    const miss = await call(readTok, 'get_missing_information', { projectId });
    expect(miss.isError).toBe(false);
    expect(miss.data.missing.some((m: any) => m.candidate === 'Arcfield Lite 15' && m.attributeKey === 'battery_life')).toBe(true);
    const conflicts = await call(readTok, 'get_conflicts', { projectId });
    expect(conflicts.data[0].evidence.length).toBe(2);
    expect(conflicts.data[0].evidence.every((e: any) => e.source && e.retrievedAt)).toBe(true);
    const ask = await call(readTok, 'ask_research_assistant', { projectId, preset: 'missing' });
    expect(ask.data.answer).toContain('Unknown');
    const table = await call(readTok, 'get_compare_table', { projectId });
    const factId = table.data.rows[0].cells[0].factIds[0];
    const ev = await call(readTok, 'get_evidence', { factId });
    expect(ev.data.source.url).toMatch(/selequo\.invalid/);
  });

  it('enforces scopes: read token cannot write, write token can', async () => {
    const denied = await call(readTok, 'add_candidate', { projectId, name: 'X' });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/write/);
    const ok = await call(writeTok, 'add_candidate', { projectId, name: 'Arcfield Mini 13' });
    expect(ok.isError).toBe(false);
    expect(ok.data.status).toBe('considering');
    const brief = await call(writeTok, 'generate_decision_brief', { projectId });
    expect(brief.data.markdown).toContain('Decision Brief');
  });

  it('cannot reach another workspace', async () => {
    const r = await call(otherWsTok, 'get_compare_table', { projectId });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/見つかりません/);
    const srch = await call(otherWsTok, 'search_comparisons', { query: 'Arcfield' });
    expect(srch.data).toEqual([]);
  });

  it('audits MCP actions with the token as actor', async () => {
    const rows = await env.db.query(`SELECT actor_type, action FROM audit_log WHERE action = 'candidate.create' AND actor_type = 'token'`);
    expect(rows.length).toBe(1);
    expect(candidateId).toBeTruthy();
  });
});
