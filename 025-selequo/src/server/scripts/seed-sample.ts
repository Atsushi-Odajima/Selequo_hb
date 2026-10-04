// Seeds a demo account with the fictional sample (3 laptops + SaaS) into a *separate* sample workspace.
// Runs only outside production. Sample pages are served from local fixtures (https://*.selequo.invalid),
// so no third-party site is contacted.
//   SELEQUO_FETCH_FIXTURES=fixtures/sample npm run seed:sample
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { buildApp } from '../app';

const config = loadConfig({ fetchFixturesDir: process.env.SELEQUO_FETCH_FIXTURES ?? 'fixtures/sample' });
if (config.env === 'production') throw new Error('seed-sample must not run in production');
mkdirSync(path.resolve(config.dataDir), { recursive: true });
const db = await openDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir ?? (config.databaseUrl ? undefined : path.resolve(config.dataDir, 'pglite')) });
const { app, runner } = await buildApp({ config, db, startJobs: false });
await app.ready();

const email = process.env.DEMO_EMAIL ?? 'demo@selequo.invalid';
const password = process.env.DEMO_PASSWORD ?? 'selequo-demo-2026';
let cookie = '';
let csrf = '';
let ws = '';
const signup = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, name: 'デモユーザー', password, workspaceName: 'サンプル（架空データ）' } });
if (signup.statusCode === 200) {
  cookie = String(signup.headers['set-cookie']).split(';')[0];
  csrf = signup.json().csrf;
  ws = signup.json().workspaceId;
} else {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  csrf = login.json().csrf;
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  const r = await app.inject({ method: 'POST', url: '/api/workspaces', headers: { cookie, 'x-csrf-token': csrf }, payload: { name: `サンプル（架空データ）${new Date().toISOString().slice(0, 10)}` } });
  ws = r.json().id ?? me.json().workspaces[0].id;
}
await db.query(`UPDATE workspaces SET is_sample = true WHERE id = $1`, [ws]);

async function call(method: string, url: string, payload?: unknown, raw?: { body: Buffer; type: string }) {
  const res = await app.inject({
    method: method as never,
    url: url.startsWith('/api') ? url : `/api/w/${ws}${url}`,
    headers: { cookie, 'x-csrf-token': csrf, ...(raw ? { 'content-type': raw.type } : {}) },
    payload: raw ? raw.body : (payload as never),
  });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.json();
}
async function upload(pid: string, file: string, fields: Record<string, string>) {
  const { readFileSync } = await import('node:fs');
  const boundary = '----seed' + Date.now();
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(file)}"\r\nContent-Type: application/octet-stream\r\n\r\n`), readFileSync(file), Buffer.from(`\r\n--${boundary}--\r\n`));
  return call('POST', `/projects/${pid}/sources/file`, undefined, { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` });
}
const F = (host: string, f: string) => `https://${host}.selequo.invalid/${f}`;

// ---- laptops
const p = await call('POST', '/projects', { title: 'ノートPCの比較（架空サンプル）', category: 'laptop', purpose: '出張が多い業務と開発作業を両立できるノートPCを選ぶ。予算は20万円以内が目安。', deadline: '2026-11-30' });
const air = await call('POST', `/projects/${p.id}/candidates`, { name: 'Arcfield Air 14', provider: 'Arcfield（架空）' });
const pro = await call('POST', `/projects/${p.id}/candidates`, { name: 'Arcfield Pro 16', provider: 'Arcfield（架空）' });
const lite = await call('POST', `/projects/${p.id}/candidates`, { name: 'Arcfield Lite 15', provider: 'Arcfield（架空）' });
for (const [url, cid, q] of [
  [F('official', 'air14.html'), air.id, 'official'],
  [F('shop', 'air14.html'), air.id, 'marketplace'],
  [F('official', 'pro16.html'), pro.id, 'official'],
  [F('official', 'lite15.html'), lite.id, 'official'],
  [F('shop', 'lite15.html'), lite.id, 'marketplace'],
]) await call('POST', `/projects/${p.id}/sources/url`, { url, candidateId: cid, quality: q });
await upload(p.id, 'fixtures/sample/raw/pro16-specsheet.pdf', { candidateId: pro.id, kind: 'pdf', quality: 'manufacturer', title: 'Arcfield Pro 16 仕様書（PDF・架空）' });
await upload(p.id, 'fixtures/sample/raw/lite15-screenshot.png', { candidateId: lite.id, kind: 'screenshot', quality: 'marketplace', title: 'サンプル家電ストア アプリ画面（架空）' });
await runner.drain();
const shot = (await call('GET', `/projects/${p.id}/sources`)).find((s: any) => s.type === 'screenshot');
await call('POST', `/projects/${p.id}/facts`, { candidateId: lite.id, attributeKey: 'price', label: 'セール価格', value: '¥127,600（税込）', sourceId: shot.id, region: { x: 0.04, y: 0.24, w: 0.62, h: 0.16 } });
const facts = await call('GET', `/projects/${p.id}/facts?kind=fact&state=candidate`);
await call('POST', `/projects/${p.id}/facts/bulk-review`, { factIds: facts.filter((f: any) => f.attributeKey).map((f: any) => f.id), action: 'confirm' });
const weight = await call('POST', `/projects/${p.id}/criteria`, { name: '軽さ', weight: 3, direction: 'lower_better', linkedAttributes: ['weight'] });
const battery = await call('POST', `/projects/${p.id}/criteria`, { name: 'バッテリー', weight: 2, direction: 'higher_better', linkedAttributes: ['battery_life'], mustHave: true, target: { op: '>=', value: 8, unit: 'h' } });
const mem = await call('POST', `/projects/${p.id}/criteria`, { name: 'メモリ', weight: 2, direction: 'higher_better', linkedAttributes: ['memory'] });
const price = await call('POST', `/projects/${p.id}/criteria`, { name: '価格', weight: 2, direction: 'lower_better', linkedAttributes: ['price'] });
await call('POST', `/projects/${p.id}/scenarios`, { name: 'Travel', description: '出張・持ち運び重視', weights: { [weight.id]: 10, [battery.id]: 8, [mem.id]: 2, [price.id]: 2 } });
await call('POST', `/projects/${p.id}/scenarios`, { name: 'Performance', description: '開発・処理性能重視', weights: { [weight.id]: 1, [battery.id]: 2, [mem.id]: 10, [price.id]: 1 } });
await call('POST', `/projects/${p.id}/scenarios`, { name: 'Budget', description: '価格重視', weights: { [weight.id]: 1, [battery.id]: 0, [mem.id]: 1, [price.id]: 10 }, mustHaves: { [battery.id]: false } });
await call('POST', `/projects/${p.id}/questions`, { text: 'Arcfield Lite 15 のバッテリー駆動時間を確認する', candidateId: lite.id, attributeKey: 'battery_life' });

// ---- SaaS
const s = await call('POST', '/projects', { title: 'チャットサポートSaaSの選定（架空サンプル）', category: 'saas', purpose: '10名のサポートチームで使うツールを選ぶ。将来40名まで拡大の可能性あり。', defaultParams: { seats: 10, costBasis: 'annual_total' } });
const ids: Record<string, string> = {};
for (const [n, name] of [
  ['alpha', 'AlphaDesk Business'],
  ['beta', 'BetaFlow Team'],
  ['gamma', 'GammaSuite Enterprise'],
]) {
  ids[n] = (await call('POST', `/projects/${s.id}/candidates`, { name, provider: '架空SaaS' })).id;
  await call('POST', `/projects/${s.id}/sources/url`, { url: F('saas', `${n}.html`), candidateId: ids[n], quality: 'official' });
}
await runner.drain();
const sf = await call('GET', `/projects/${s.id}/facts?kind=fact&state=candidate`);
await call('POST', `/projects/${s.id}/facts/bulk-review`, { factIds: sf.filter((f: any) => f.attributeKey).map((f: any) => f.id), action: 'confirm' });
const cost = await call('POST', `/projects/${s.id}/criteria`, { name: '年間コスト', weight: 5, direction: 'lower_better', linkedAttributes: ['price'] });
const sso = await call('POST', `/projects/${s.id}/criteria`, { name: 'SSO', weight: 3, direction: 'boolean', linkedAttributes: ['sso'], mustHave: true });
const sla = await call('POST', `/projects/${s.id}/criteria`, { name: 'SLA', weight: 2, direction: 'higher_better', linkedAttributes: ['sla'] });
await call('POST', `/projects/${s.id}/scenarios`, { name: 'Small Team', weights: { [cost.id]: 10, [sso.id]: 0, [sla.id]: 2 }, mustHaves: { [sso.id]: false }, params: { seats: 5 } });
await call('POST', `/projects/${s.id}/scenarios`, { name: 'Enterprise Security', weights: { [cost.id]: 2, [sso.id]: 10, [sla.id]: 6 }, params: { seats: 40 } });
await call('POST', `/projects/${s.id}/scenarios`, { name: 'Lowest Cost', weights: { [cost.id]: 10, [sso.id]: 0, [sla.id]: 0 }, mustHaves: { [sso.id]: false }, params: { seats: 10 } });

console.log(`Sample seeded into workspace ${ws}\n  login: ${email} / ${password}`);
await app.close();
await db.close();
