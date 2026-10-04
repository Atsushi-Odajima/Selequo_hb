import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { AIProvider } from '../src/server/ai/provider';
import { Fetcher } from '../src/server/import/fetcher';

export const FIX = 'fixtures/sample';
export const fixtureUrl = (host: string, file: string) => `https://${host}.selequo.invalid/${file}`;

export async function setup(opts: { ai?: AIProvider | null; fetcher?: Fetcher } = {}) {
  const config = loadConfig({ env: 'test', fetchFixturesDir: FIX, secret: 'test-secret-'.padEnd(64, 'x'), pgliteDir: undefined, databaseUrl: undefined });
  const db = await openDb({});
  const built = await buildApp({ config, db, aiProvider: opts.ai ?? null, startJobs: false, fetcher: opts.fetcher });
  await built.app.ready();
  const { app } = built;

  class Client {
    cookie = '';
    csrf = '';
    ws = '';
    userId = '';
    bearer: string | null = null;
    async req<T = any>(method: string, url: string, body?: unknown, extra: { headers?: Record<string, string>; raw?: Buffer; contentType?: string } = {}) {
      const headers: Record<string, string> = { ...(extra.headers ?? {}) };
      if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
      else {
        if (this.cookie) headers.cookie = this.cookie;
        if (this.csrf) headers['x-csrf-token'] = this.csrf;
      }
      const full = url.startsWith('/api/') || url.startsWith('/mcp') ? url : `/api/w/${this.ws}${url}`;
      const res = await app.inject({
        method: method as never,
        url: full,
        headers: extra.contentType ? { ...headers, 'content-type': extra.contentType } : headers,
        payload: extra.raw ?? (body === undefined ? undefined : (body as never)),
      });
      let json: T | undefined;
      try {
        json = res.json() as T;
      } catch {
        json = undefined;
      }
      return { status: res.statusCode, json: json as T, body: res.rawPayload, headers: res.headers };
    }
    async upload(projectId: string, file: string, fields: Record<string, string>) {
      const data = readFileSync(file);
      const boundary = '----selequo' + Math.random().toString(16).slice(2);
      const parts: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.split('/').pop()}"\r\nContent-Type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`));
      return this.req('POST', `/projects/${projectId}/sources/file`, undefined, { raw: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` });
    }
  }

  async function user(email: string, name = email.split('@')[0]) {
    const c = new Client();
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, name, password: 'correct-horse-battery' } });
    if (res.statusCode !== 200) throw new Error(`signup failed ${res.body}`);
    const j = res.json();
    c.cookie = String(res.headers['set-cookie']).split(';')[0];
    c.csrf = j.csrf;
    c.ws = j.workspaceId;
    c.userId = j.userId;
    return c;
  }

  /** Clone a client for another workspace/role (same session). */
  function inWs(c: Client, ws: string) {
    const n = new Client();
    Object.assign(n, c);
    n.ws = ws;
    return n;
  }

  return { app, db, runner: built.runner, deps: built.deps, config, user, inWs, Client, close: async () => { await app.close(); await db.close(); } };
}

export type TestEnv = Awaited<ReturnType<typeof setup>>;

/** Build the fictional 3-laptop sample through the public API (official page, shop page, PDF, screenshot). */
export async function buildLaptopSample(env: TestEnv, c: Awaited<ReturnType<TestEnv['user']>>) {
  const p = (await c.req('POST', '/projects', { title: 'ノートPCの比較（サンプル）', category: 'laptop', purpose: '出張用と開発用の兼用ノートPCを選ぶ' })).json;
  const air = (await c.req('POST', `/projects/${p.id}/candidates`, { name: 'Arcfield Air 14', provider: 'Arcfield' })).json;
  const pro = (await c.req('POST', `/projects/${p.id}/candidates`, { name: 'Arcfield Pro 16', provider: 'Arcfield' })).json;
  const lite = (await c.req('POST', `/projects/${p.id}/candidates`, { name: 'Arcfield Lite 15', provider: 'Arcfield' })).json;
  const add = (url: string, candidateId: string, quality: string) => c.req('POST', `/projects/${p.id}/sources/url`, { url, candidateId, quality });
  await add(fixtureUrl('official', 'air14.html'), air.id, 'official');
  await add(fixtureUrl('shop', 'air14.html'), air.id, 'marketplace');
  await add(fixtureUrl('official', 'pro16.html'), pro.id, 'official');
  await add(fixtureUrl('official', 'lite15.html'), lite.id, 'official');
  await add(fixtureUrl('shop', 'lite15.html'), lite.id, 'marketplace');
  await c.upload(p.id, `${FIX}/raw/pro16-specsheet.pdf`, { candidateId: pro.id, kind: 'pdf', quality: 'manufacturer' });
  await c.upload(p.id, `${FIX}/raw/lite15-screenshot.png`, { candidateId: lite.id, kind: 'screenshot', quality: 'marketplace' });
  await env.runner.drain();
  return { project: p, air, pro, lite };
}

export async function confirmAll(c: Awaited<ReturnType<TestEnv['user']>>, projectId: string) {
  const facts = (await c.req('GET', `/projects/${projectId}/facts?kind=fact&state=candidate`)).json as { id: string; attributeKey: string | null }[];
  await c.req('POST', `/projects/${projectId}/facts/bulk-review`, { factIds: facts.filter((f) => f.attributeKey).map((f) => f.id), action: 'confirm' });
}
