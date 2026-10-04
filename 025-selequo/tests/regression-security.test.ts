// Regression tests for the findings of the internal security review (2026-10-04).
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { buildLaptopSample, setup } from './helpers';
import { sha256 } from '../src/server/auth/crypto';

const multipart = (zip: Uint8Array) => {
  const boundary = '----x' + Date.now();
  return {
    raw: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.zip"\r\nContent-Type: application/zip\r\n\r\n`), Buffer.from(zip), Buffer.from(`\r\n--${boundary}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
};

describe('import / restore cannot reach other tenants', () => {
  it('rejects project imports that reference foreign rows and strips decisions', async () => {
    const env = await setup();
    const victim = await env.user('victim@example.com');
    const v = await buildLaptopSample(env, victim);
    const vSources = (await victim.req('GET', `/projects/${v.project.id}/sources`)).json as any[];
    const attacker = await env.user('attacker@example.com');
    const p = (await attacker.req('POST', '/projects', { title: 'mine' })).json;
    const c = (await attacker.req('POST', `/projects/${p.id}/candidates`, { name: 'c' })).json;
    const exp = (await attacker.req('GET', `/projects/${p.id}/export.json`)).json;
    // fact pointing at the victim's source
    const evil = { ...exp, facts: [{ id: crypto.randomUUID(), project_id: p.id, candidate_id: c.id, source_id: vSources[0].id, raw_label: 'x', raw_value: 'y', kind: 'fact', source_range: { type: 'text', start: 0, end: 100000, context: '' }, review_state: 'confirmed', extracted_by: 'x' }] };
    const r = await attacker.req('POST', '/projects/import', evil);
    expect(r.status).toBe(400);
    // file_key and foreign candidate references are rejected / dropped
    const evil2 = { ...exp, sources: [{ id: crypto.randomUUID(), project_id: p.id, candidate_id: v.air.id, type: 'pdf', file_key: vSources[0].fileKey ?? 'ws/x/y.pdf', status: 'ready', quality: 'unknown' }] };
    expect((await attacker.req('POST', '/projects/import', evil2)).status).toBe(400);
    const evil3 = { ...exp, normalization_rules: [{ id: crypto.randomUUID(), project_id: v.project.id, pattern: 'x', attribute_key: 'memory' }] };
    expect((await attacker.req('POST', '/projects/import', evil3)).status).toBe(400);
    // decisions / chosen status are never imported
    const d = { ...exp, candidates: [{ ...exp.candidates[0], status: 'chosen' }], decisions: [{ id: crypto.randomUUID(), project_id: p.id, chosen_candidate_id: c.id, reason: 'x', status: 'decided' }] };
    const ok = await attacker.req('POST', '/projects/import', d);
    expect(ok.status).toBe(200);
    const cands = (await attacker.req('GET', `/projects/${ok.json.projectId}/candidates`)).json as any[];
    expect(cands.every((x) => x.status !== 'chosen')).toBe(true);
    expect((await attacker.req('GET', `/projects/${ok.json.projectId}/decision`)).json.status).toBe('draft');
    await env.close();
  });

  it('restore cannot overwrite or reference another tenant\'s files', async () => {
    const env = await setup();
    const victim = await env.user('victim2@example.com');
    const v = await buildLaptopSample(env, victim);
    const vPdf = ((await victim.req('GET', `/projects/${v.project.id}/sources`)).json as any[]).find((s) => s.type === 'pdf');
    const vKey = decodeURIComponent(vPdf.fileUrl.match(/key=([^&]+)/)[1]);
    const before = await env.deps.storage.get(vKey);
    const attacker = await env.user('attacker2@example.com');
    await buildLaptopSample(env, attacker);
    const zip = (await attacker.req('GET', '/backup')).body;
    const entries = unzipSync(new Uint8Array(zip));
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
    const evilContent = strToU8('ATTACKER CONTENT');
    const oldKey = manifest.files[0].key;
    delete entries[`files/${oldKey}`];
    entries[`files/${vKey}`] = evilContent;
    manifest.files[0] = { key: vKey, sha256: sha256(evilContent), size: evilContent.length };
    entries['manifest.json'] = strToU8(JSON.stringify(manifest));
    const r = await attacker.req('POST', '/api/restore', undefined, multipart(zipSync(entries)));
    expect(r.status).toBe(200);
    expect(Buffer.from((await env.deps.storage.get(vKey))!).equals(Buffer.from(before!))).toBe(true);
    // no restored row points at the victim's key
    const rows = await env.db.query(`SELECT count(*)::int AS n FROM sources WHERE file_key = $1`, [vKey]);
    expect(rows[0].n).toBe(1);
    await env.close();
  }, 60000);
});

describe('other review findings', () => {
  it('admins cannot invite admins; guest share DTO hides internals; audit limit is validated; comments are scoped', async () => {
    const env = await setup();
    const owner = await env.user('own@example.com');
    const s = await buildLaptopSample(env, owner);
    const admin = await env.user('adm@example.com');
    const inv = (await owner.req('POST', '/invitations', { email: 'adm@example.com', role: 'admin' })).json;
    await admin.req('POST', `/api/invitations/${inv.token}/accept`);
    const a = env.inWs(admin, owner.ws);
    expect((await a.req('POST', '/invitations', { email: 'x@example.com', role: 'admin' })).status).toBe(403);
    expect((await a.req('POST', '/invitations', { email: 'x@example.com', role: 'editor' })).status).toBe(200);
    await owner.req('PATCH', `/candidates/${s.air.id}`, { notes: '社内メモ: 値引き交渉中' });
    await owner.req('PATCH', '', { sharingEnabled: true });
    const link = (await owner.req('POST', `/projects/${s.project.id}/shares`, {})).json;
    const token = link.url.split('/s/')[1];
    const guest = await env.app.inject({ method: 'GET', url: `/api/share/${token}` });
    const body = guest.body;
    expect(guest.statusCode).toBe(200);
    expect(body).not.toContain('値引き交渉中');
    expect(body).not.toContain(s.air.id);
    expect(body).not.toContain(s.project.id);
    expect((await owner.req('GET', '/audit?limit=abc')).status).toBe(200);
    const other = await env.user('other@example.com');
    const op = (await other.req('POST', '/projects', { title: 'o' })).json;
    expect((await other.req('POST', `/projects/${op.id}/comments`, { entityType: 'candidate', entityId: s.air.id, body: 'x' })).status).toBe(404);
    // javascript: URLs are rejected
    expect((await owner.req('POST', `/projects/${s.project.id}/sources/url`, { url: 'javascript:alert(1)' })).status).toBe(400);
    // search projectId filter works
    const res = (await owner.req('GET', `/search?q=Arcfield&projectId=${s.project.id}`)).json as any[];
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((x) => x.projectId === s.project.id)).toBe(true);
    await env.close();
  }, 60000);
});
