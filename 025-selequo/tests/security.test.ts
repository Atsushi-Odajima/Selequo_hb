import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedIp, validateUrl, SsrfError } from '../src/server/import/ssrf';
import { Fetcher, parseRobots, robotsAllows } from '../src/server/import/fetcher';
import { strToU8, zipSync } from 'fflate';
import { setup, buildLaptopSample, type TestEnv } from './helpers';

describe('SSRF protection', () => {
  const allowPorts = [80, 443];
  it('blocks private, loopback, link-local, metadata and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fd00:ec2::254', 'fe80::1', '64:ff9b::10.0.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedIp('93.184.215.14')).toBe(false);
    expect(isBlockedIp('2606:4700::1111')).toBe(false);
  });

  it('rejects bad schemes, credentials, ports, internal hostnames and numeric hosts', async () => {
    const bad = ['file:///etc/passwd', 'gopher://x', 'http://user:pw@example.com/', 'http://example.com:22/', 'http://localhost/', 'http://metadata.google.internal/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/'];
    for (const u of bad) await expect(validateUrl(u, { allowPorts, resolver: async () => [{ address: '93.184.215.14', family: 4 }] }), u).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects public-looking hostnames that resolve to private addresses (DNS rebinding)', async () => {
    await expect(validateUrl('https://evil.example/', { allowPorts, resolver: async () => [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.1', family: 4 }] })).rejects.toBeInstanceOf(SsrfError);
    const ok = await validateUrl('https://good.example/', { allowPorts, resolver: async () => [{ address: '93.184.215.14', family: 4 }] });
    expect(ok.address).toBe('93.184.215.14');
  });

  it('fails the import job with an SSRF error instead of fetching', async () => {
    const env = await setup({ fetcher: new Fetcher({ allowPorts, maxBytes: 1e6, resolver: async () => [{ address: '127.0.0.1', family: 4 }] }) });
    const c = await env.user('ssrf@example.com');
    const p = (await c.req('POST', '/projects', { title: 'x' })).json;
    const s = (await c.req('POST', `/projects/${p.id}/sources/url`, { url: 'http://169.254.169.254/latest/meta-data/' })).json;
    const s2 = (await c.req('POST', `/projects/${p.id}/sources/url`, { url: 'https://internal.example/' })).json;
    await env.runner.drain();
    const after = (await c.req('GET', `/sources/${s.id}`)).json;
    const after2 = (await c.req('GET', `/sources/${s2.id}`)).json;
    expect(after.status).toBe('failed');
    expect(after.error).toMatch(/禁止|許可/);
    expect(after2.status).toBe('failed');
    await env.close();
  });

  it('respects robots.txt rules', () => {
    const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: SelequoBot\nDisallow: /nobot', 'selequobot');
    expect(robotsAllows(r, '/nobot/x')).toBe(false);
    expect(robotsAllows(r, '/private/x')).toBe(true); // specific group wins over *
    const star = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok', 'selequobot');
    expect(robotsAllows(star, '/private/x')).toBe(false);
    expect(robotsAllows(star, '/private/ok/1')).toBe(true);
    expect(robotsAllows({ disallowAll: true, rules: [] }, '/')).toBe(false);
  });
});

describe('tenant isolation, RBAC, CSRF, uploads', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => env.close());

  it('isolates workspaces (projects, search, files, tokens)', async () => {
    const a = await env.user('tenant-a@example.com');
    const b = await env.user('tenant-b@example.com');
    const pa = (await a.req('POST', '/projects', { title: '秘密プロジェクトA' })).json;
    const ca = (await a.req('POST', `/projects/${pa.id}/candidates`, { name: 'TopSecret' })).json;
    // B cannot reach A's workspace or entities, even by id
    expect((await b.req('GET', `/api/w/${a.ws}/projects`)).status).toBe(404);
    expect((await b.req('GET', `/projects/${pa.id}`)).status).toBe(404);
    expect((await b.req('PATCH', `/candidates/${ca.id}`, { name: 'hacked' })).status).toBe(404);
    expect((await b.req('POST', `/projects/${pa.id}/candidates`, { name: 'x' })).status).toBe(404);
    const search = (await b.req('GET', `/search?q=${encodeURIComponent('TopSecret')}`)).json;
    expect(search).toHaveLength(0);
    // A's API token cannot be used on B's workspace
    const tok = (await a.req('POST', '/tokens', { name: 't', scopes: ['read'] })).json.token;
    const t = new env.Client();
    t.bearer = tok;
    t.ws = b.ws;
    expect((await t.req('GET', '/projects')).status).toBe(401);
    t.ws = a.ws;
    expect((await t.req('GET', '/projects')).status).toBe(200);
  });

  it('enforces roles Owner/Admin/Editor/Reviewer/Viewer', async () => {
    const owner = await env.user('owner@example.com');
    const roles = ['admin', 'editor', 'reviewer', 'viewer'] as const;
    const clients: Record<string, any> = {};
    for (const r of roles) {
      const u = await env.user(`${r}@example.com`);
      const inv = (await owner.req('POST', '/invitations', { email: `${r}@example.com`, role: r })).json;
      expect((await u.req('POST', `/api/invitations/${inv.token}/accept`)).status).toBe(200);
      clients[r] = env.inWs(u, owner.ws);
    }
    const p = (await owner.req('POST', '/projects', { title: 'RBAC' })).json;
    expect((await clients.viewer.req('POST', `/projects/${p.id}/candidates`, { name: 'x' })).status).toBe(403);
    expect((await clients.reviewer.req('POST', `/projects/${p.id}/candidates`, { name: 'x' })).status).toBe(403);
    const cand = (await clients.editor.req('POST', `/projects/${p.id}/candidates`, { name: 'x' })).json;
    expect(cand.id).toBeTruthy();
    expect((await clients.viewer.req('GET', `/projects/${p.id}/compare`)).status).toBe(200);
    expect((await clients.reviewer.req('POST', `/projects/${p.id}/questions`, { text: '保証は？' })).status).toBe(200);
    expect((await clients.editor.req('PATCH', '', { aiEnabled: false })).status).toBe(403);
    expect((await clients.admin.req('PATCH', '', { aiEnabled: true })).status).toBe(200);
    expect((await clients.admin.req('PATCH', `/members/${clients.viewer.userId}`, { role: 'admin' })).status).toBe(403); // only owner grants admin
    expect((await owner.req('PATCH', `/members/${clients.viewer.userId}`, { role: 'editor' })).status).toBe(200);
    expect((await clients.viewer.req('GET', '/backup')).status).toBe(403);
    // viewer cannot mint a write token
    const v2 = await env.user('viewer2@example.com');
    const inv = (await owner.req('POST', '/invitations', { email: 'viewer2@example.com', role: 'viewer' })).json;
    await v2.req('POST', `/api/invitations/${inv.token}/accept`);
    expect((await env.inWs(v2, owner.ws).req('POST', '/tokens', { name: 'w', scopes: ['write'] })).status).toBe(403);
    // audit has role change
    const audit = (await owner.req('GET', '/audit')).json as { action: string }[];
    expect(audit.some((a) => a.action === 'member.role')).toBe(true);
  });

  it('requires CSRF token for cookie-authenticated mutations', async () => {
    const u = await env.user('csrf@example.com');
    const noCsrf = env.inWs(u, u.ws);
    noCsrf.csrf = '';
    expect((await noCsrf.req('POST', '/projects', { title: 'x' })).status).toBe(403);
    expect((await u.req('POST', '/projects', { title: 'x' })).status).toBe(200);
  });

  it('validates uploads by content (magic bytes), not by name', async () => {
    const u = await env.user('upload@example.com');
    const p = (await u.req('POST', '/projects', { title: 'up' })).json;
    const cand = (await u.req('POST', `/projects/${p.id}/candidates`, { name: 'c' })).json;
    // an executable disguised as PNG
    const fs = await import('node:fs');
    const tmp = `${process.env.TMPDIR ?? '/tmp'}/fake-${Date.now()}.png`;
    fs.writeFileSync(tmp, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff]));
    const r = await u.upload(p.id, tmp, { candidateId: cand.id, kind: 'screenshot' });
    expect(r.status).toBe(400);
    fs.writeFileSync(tmp, 'just text');
    const r2 = await u.upload(p.id, tmp, { candidateId: cand.id, kind: 'screenshot' });
    expect(r2.status).toBe(400);
    fs.unlinkSync(tmp);
  });

  it('sets security headers (CSP, nosniff, frame-ancestors)', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('backup zip validation', () => {
  it('rejects path traversal and tampered checksums', async () => {
    const env = await setup();
    const u = await env.user('zip@example.com');
    const send = (zip: Uint8Array) => {
      const boundary = '----b' + Date.now();
      const raw = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.zip"\r\nContent-Type: application/zip\r\n\r\n`),
        Buffer.from(zip),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return u.req('POST', '/api/restore', undefined, { raw, contentType: `multipart/form-data; boundary=${boundary}` });
    };
    const evil = zipSync({ 'manifest.json': strToU8('{}'), 'data.json': strToU8('{}'), 'files/../../etc/passwd': strToU8('x') });
    const r = await send(evil);
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/traversal|不正/);
    await buildLaptopSample(env, u);
    const good = await u.req('GET', '/backup');
    const { unzipSync } = await import('fflate');
    const entries = unzipSync(new Uint8Array(good.body));
    entries['data.json'] = strToU8(new TextDecoder().decode(entries['data.json']).replace('Arcfield', 'Arcfie1d'));
    const tampered = await send(zipSync(entries));
    expect(tampered.status).toBe(400);
    expect(tampered.json.message).toMatch(/チェックサム/);
    await env.close();
  });
});

describe('SSRF IPv6 embedded-IPv4 forms', () => {
  it('blocks NAT64 / 6to4 / Teredo / compat / SIIT forms and non-global ranges', () => {
    for (const ip of ['64:ff9b::a00:1', '64:ff9b:1::a9fe:a9fe', '::7f00:1', '::ffff:0:7f00:1', '2002:7f00:1::', '2001:0:4136:e378::1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', 'fc00::1', '::', '100::1']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedIp('::ffff:93.184.215.14')).toBe(false);
  });
});
