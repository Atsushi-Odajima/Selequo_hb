// Workspace backup / restore (ZIP: manifest.json + data.json + files/*).
// - manifest has schemaVersion, appVersion, checksum (sha256 of data.json) and per-file hashes
// - restore goes into a fresh workspace; every id is re-mapped so restores never collide
// - ZIP entries are validated (no path traversal, size/entry limits)

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { SCHEMA_VERSION } from '../db/schema';
import { newId, sha256 } from '../auth/crypto';
import { assertSafeKey } from '../storage';
import { audit, badRequest, need, type Ctx } from './core';
import { indexEntity } from './search';

export const BACKUP_TABLES = [
  'projects',
  'candidates',
  'sources',
  'attributes',
  'normalization_rules',
  'facts',
  'price_snapshots',
  'criteria',
  'scenarios',
  'questions',
  'decisions',
  'briefs',
  'comments',
  'user_notes',
  'audit_log',
] as const;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_ENTRIES = 20000;
const MAX_TOTAL = 1024 * 1024 * 1024;

export interface BackupManifest {
  format: 'selequo-backup';
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  workspaceId: string;
  workspaceName: string;
  counts: Record<string, number>;
  checksum: string;
  files: { key: string; sha256: string; size: number }[];
}

export async function createBackup(ctx: Ctx): Promise<Uint8Array> {
  need(ctx, 'admin');
  const ws = await ctx.db.one(`SELECT * FROM workspaces WHERE id = $1`, [ctx.workspaceId]);
  const data: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) {
    data[t] = (await ctx.db.query(`SELECT * FROM ${t} WHERE workspace_id = $1 ORDER BY created_at`, [ctx.workspaceId])).map(serializeRow);
  }
  const userIds = new Set<string>();
  for (const t of BACKUP_TABLES) for (const r of data[t] as Record<string, unknown>[]) for (const k of ['created_by', 'reviewed_by', 'decided_by', 'author_id', 'actor_id']) if (typeof r[k] === 'string') userIds.add(r[k] as string);
  data.users = (await ctx.db.query(`SELECT id, email, name FROM users WHERE id = ANY($1)`, [[...userIds]])) as unknown[];
  data.workspace = [{ name: ws?.name, ai_enabled: ws?.ai_enabled, sharing_enabled: ws?.sharing_enabled, external_search_enabled: ws?.external_search_enabled }];
  const dataJson = strToU8(JSON.stringify(data));
  const files: Record<string, Uint8Array> = {};
  const fileList: BackupManifest['files'] = [];
  for (const s of data.sources as { file_key: string | null }[]) {
    if (!s.file_key) continue;
    const buf = await ctx.storage.get(s.file_key);
    if (!buf) continue;
    files[`files/${s.file_key}`] = buf;
    fileList.push({ key: s.file_key, sha256: sha256(buf), size: buf.length });
  }
  const manifest: BackupManifest = {
    format: 'selequo-backup',
    schemaVersion: SCHEMA_VERSION,
    appVersion: ctx.config.appVersion,
    createdAt: new Date().toISOString(),
    workspaceId: ctx.workspaceId,
    workspaceName: ws?.name,
    counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, data[t].length])),
    checksum: sha256(dataJson),
    files: fileList,
  };
  await audit(ctx, 'backup.create', { type: 'workspace', id: ctx.workspaceId }, { counts: manifest.counts, files: fileList.length });
  return zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)), 'data.json': dataJson, ...files }, { level: 6 });
}

function serializeRow(r: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) o[k] = v instanceof Date ? v.toISOString() : v;
  return o;
}

export function readBackup(zip: Uint8Array): { manifest: BackupManifest; data: Record<string, Record<string, unknown>[]>; files: Map<string, Uint8Array> } {
  let total = 0;
  let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > MAX_ENTRIES || total > MAX_TOTAL) throw new Error('backup too large');
        return true;
      },
    });
  } catch (e) {
    throw badRequest(`バックアップを読み込めません: ${(e as Error).message}`);
  }
  for (const name of Object.keys(entries)) {
    if (name === 'manifest.json' || name === 'data.json') continue;
    if (!name.startsWith('files/')) throw badRequest(`不正なエントリ: ${name}`);
    try {
      assertSafeKey(name.slice(6));
    } catch {
      throw badRequest(`不正なファイルパス（path traversal）: ${name}`);
    }
  }
  if (!entries['manifest.json'] || !entries['data.json']) throw badRequest('manifest.json / data.json がありません');
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as BackupManifest;
  if (manifest.format !== 'selequo-backup') throw badRequest('Selequoのバックアップではありません');
  if (manifest.schemaVersion > SCHEMA_VERSION) throw badRequest(`新しいスキーマ（v${manifest.schemaVersion}）のバックアップは復元できません`);
  if (sha256(entries['data.json']) !== manifest.checksum) throw badRequest('チェックサムが一致しません（破損または改ざん）');
  const files = new Map<string, Uint8Array>();
  for (const f of manifest.files) {
    const buf = entries[`files/${f.key}`];
    if (!buf) throw badRequest(`ファイルが欠落しています: ${f.key}`);
    if (sha256(buf) !== f.sha256) throw badRequest(`ファイルのハッシュが一致しません: ${f.key}`);
    files.set(f.key, buf);
  }
  return { manifest, data: JSON.parse(strFromU8(entries['data.json'])), files };
}

/** Restore into a NEW workspace owned by the calling user. Returns the new workspace id and id map size. */
export async function restoreBackup(ctx: Omit<Ctx, 'workspaceId' | 'role'> & { workspaceId?: string }, zip: Uint8Array, opts: { name?: string } = {}) {
  if (ctx.actor.type !== 'user' || !ctx.actor.userId) throw badRequest('復元はログインユーザーのみ実行できます');
  const { manifest, data, files } = readBackup(zip);
  const userId = ctx.actor.userId;
  const idMap = new Map<string, string>();
  const newWs = newId();
  idMap.set(manifest.workspaceId, newWs);
  for (const t of BACKUP_TABLES) for (const r of data[t] ?? []) idMap.set(String(r.id), newId());
  // users: map by e-mail to an existing account, otherwise to the restoring user
  for (const u of (data.users ?? []) as { id: string; email: string }[]) {
    const ex = await ctx.db.one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [u.email]);
    idMap.set(u.id, ex?.id ?? userId);
  }
  const remap = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replace(UUID_RE, (m) => idMap.get(m.toLowerCase()) ?? idMap.get(m) ?? m));
  const wsMeta = (data.workspace?.[0] ?? {}) as Record<string, unknown>;
  await ctx.db.tx(async (db) => {
    await db.query(`INSERT INTO workspaces (id, name, ai_enabled, sharing_enabled, external_search_enabled) VALUES ($1,$2,$3,$4,$5)`, [
      newWs,
      opts.name ?? `${manifest.workspaceName ?? 'Workspace'}（復元 ${new Date().toISOString().slice(0, 10)}）`,
      wsMeta.ai_enabled ?? true,
      false, // sharing is always OFF after restore
      wsMeta.external_search_enabled ?? false,
    ]);
    await db.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, [newWs, userId]);
    for (const t of BACKUP_TABLES) {
      for (const raw of data[t] ?? []) {
        const row = remap(raw) as Record<string, unknown>;
        row.workspace_id = newWs;
        await insertRow(db, t, row);
      }
    }
  });
  for (const [oldKey, buf] of files) {
    const newKey = String(remap(oldKey));
    assertSafeKey(newKey);
    await ctx.storage.put(newKey, buf, 'application/octet-stream');
  }
  await reindexWorkspace(ctx.db, newWs);
  await audit({ db: ctx.db, workspaceId: newWs, actor: ctx.actor }, 'backup.restore', { type: 'workspace', id: newWs }, { from: manifest.workspaceId, schemaVersion: manifest.schemaVersion, appVersion: manifest.appVersion, counts: manifest.counts });
  return { workspaceId: newWs, counts: manifest.counts };
}

export async function reindexWorkspace(db: Ctx['db'], workspaceId: string) {
  await db.query(`DELETE FROM search_index WHERE workspace_id = $1`, [workspaceId]);
  for (const p of await db.query(`SELECT id, title, purpose, category FROM projects WHERE workspace_id = $1`, [workspaceId])) await indexEntity(db, workspaceId, 'project', p.id, p.title, `${p.purpose ?? ''} ${p.category ?? ''}`);
  for (const c of await db.query(`SELECT id, project_id, name, provider, notes FROM candidates WHERE workspace_id = $1`, [workspaceId])) await indexEntity(db, workspaceId, 'candidate', c.id, c.name, `${c.provider ?? ''} ${c.notes ?? ''}`);
  for (const s of await db.query(`SELECT id, project_id, title, url, extracted_text FROM sources WHERE workspace_id = $1 AND status <> 'deleted'`, [workspaceId]))
    await indexEntity(db, workspaceId, 'source', s.id, s.title ?? s.url ?? 'source', `${s.url ?? ''}\n${s.extracted_text ?? ''}`);
  for (const f of await db.query(`SELECT f.id, f.project_id, f.raw_label, f.raw_value, f.source_range FROM facts f JOIN sources s ON s.id = f.source_id WHERE f.workspace_id = $1 AND s.status <> 'deleted'`, [workspaceId]))
    await indexEntity(db, workspaceId, 'fact', f.id, `${f.raw_label}: ${f.raw_value}`, f.source_range?.context ?? '');
  for (const q of await db.query(`SELECT id, project_id, text, answer FROM questions WHERE workspace_id = $1`, [workspaceId])) await indexEntity(db, workspaceId, 'question', q.id, q.text, q.answer ?? '');
  for (const d of await db.query(`SELECT id, project_id, reason, assumptions FROM decisions WHERE workspace_id = $1`, [workspaceId])) await indexEntity(db, workspaceId, 'decision', d.id, `判断: ${String(d.reason).slice(0, 80)}`, `${d.reason} ${d.assumptions ?? ''}`);
  // project_id for search rows
  await db.query(
    `UPDATE search_index si SET project_id = COALESCE((SELECT project_id FROM candidates WHERE id = si.entity_id), (SELECT project_id FROM sources WHERE id = si.entity_id), (SELECT project_id FROM facts WHERE id = si.entity_id), (SELECT project_id FROM questions WHERE id = si.entity_id), (SELECT project_id FROM decisions WHERE id = si.entity_id), CASE WHEN si.entity_type = 'project' THEN si.entity_id END) WHERE workspace_id = $1`,
    [workspaceId],
  );
}

// ---------------- project export / import (JSON template incl. sources text, facts and criteria)

export async function exportProjectJson(ctx: Ctx, projectId: string) {
  need(ctx, 'viewer');
  const out: Record<string, unknown> = { format: 'selequo-project', schemaVersion: SCHEMA_VERSION, appVersion: ctx.config.appVersion, exportedAt: new Date().toISOString() };
  const proj = await ctx.db.one(`SELECT * FROM projects WHERE id = $1 AND workspace_id = $2`, [projectId, ctx.workspaceId]);
  if (!proj) throw badRequest('プロジェクトがありません');
  out.project = serializeRow(proj);
  for (const t of ['candidates', 'sources', 'attributes', 'normalization_rules', 'facts', 'price_snapshots', 'criteria', 'scenarios', 'questions', 'decisions'] as const) {
    out[t] = (await ctx.db.query(`SELECT * FROM ${t} WHERE project_id = $1 AND workspace_id = $2`, [projectId, ctx.workspaceId])).map((r) => {
      const s = serializeRow(r);
      if (t === 'sources') s.file_key = null; // files are not part of a project export (use full backup)
      return s;
    });
  }
  const body = JSON.stringify(out);
  await audit(ctx, 'project.export', { type: 'project', id: projectId, projectId }, { format: 'json' });
  return { ...out, checksum: sha256(body) };
}

export async function importProjectJson(ctx: Ctx, payload: Record<string, any>) {
  need(ctx, 'editor');
  if (payload?.format !== 'selequo-project') throw badRequest('Selequoのプロジェクトファイルではありません');
  if (payload.schemaVersion > SCHEMA_VERSION) throw badRequest('新しいスキーマのファイルは読み込めません');
  const idMap = new Map<string, string>();
  idMap.set(payload.project.id, newId());
  const tables = ['candidates', 'sources', 'attributes', 'normalization_rules', 'facts', 'price_snapshots', 'criteria', 'scenarios', 'questions', 'decisions'] as const;
  for (const t of tables) for (const r of payload[t] ?? []) idMap.set(String(r.id), newId());
  const remap = (v: unknown): any => JSON.parse(JSON.stringify(v).replace(UUID_RE, (m) => idMap.get(m) ?? (/^[0-9a-f-]{36}$/i.test(m) ? m : m)));
  const userCols = ['created_by', 'reviewed_by', 'decided_by'];
  const newProjectId = idMap.get(payload.project.id)!;
  await ctx.db.tx(async (db) => {
    const p = remap(payload.project);
    p.workspace_id = ctx.workspaceId;
    p.created_by = ctx.actor.userId;
    p.title = `${p.title}（インポート）`;
    await insertRow(db, 'projects', p);
    for (const t of tables)
      for (const raw of payload[t] ?? []) {
        const row = remap(raw);
        row.workspace_id = ctx.workspaceId;
        for (const c of userCols) if (c in row && row[c]) row[c] = ctx.actor.userId;
        if (t === 'sources' && row.type !== 'manual') row.status = row.status === 'deleted' ? 'deleted' : 'ready';
        await insertRow(db, t, row);
      }
  });
  await reindexWorkspace(ctx.db, ctx.workspaceId);
  await audit(ctx, 'project.import', { type: 'project', id: newProjectId, projectId: newProjectId }, {});
  return { projectId: newProjectId };
}

async function insertRow(db: Ctx['db'], table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => {
    const v = row[c];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v);
    if (Array.isArray(v) && (c === 'injection_flags' || c === 'pages')) return JSON.stringify(v);
    return v;
  });
  await db.query(`INSERT INTO ${table} (${cols.map((c) => `"${c.replace(/[^a-z_]/g, '')}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
}
