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
const MAX_TOTAL = 200 * 1024 * 1024; // in-memory restore: keep bounded

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
        if (total > 20 * 1024 * 1024 && total > zip.length * 50) throw new Error('compression ratio too high');
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

/** Restore into a NEW workspace owned by the calling user. All rows are re-validated (see sanitizeRows). */
export async function restoreBackup(ctx: Omit<Ctx, 'workspaceId' | 'role'> & { workspaceId?: string }, zip: Uint8Array, opts: { name?: string } = {}) {
  if (ctx.actor.type !== 'user' || !ctx.actor.userId) throw badRequest('復元はログインユーザーのみ実行できます');
  const { manifest, data, files } = readBackup(zip);
  const userId = ctx.actor.userId;
  const newWs = newId();
  // file keys are always rewritten under the new workspace prefix; only keys listed in the manifest are accepted
  const fileKeyMap = new Map<string, string>();
  for (const oldKey of files.keys()) {
    const ext = (oldKey.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '').toLowerCase();
    fileKeyMap.set(oldKey, `ws/${newWs}/restored/${newId()}${ext}`);
  }
  const rows = sanitizeRows(data as Record<string, unknown[]>, BACKUP_TABLES, { userId, fileKeyMap, mode: 'restore' });
  const wsMeta = ((data as Record<string, unknown[]>).workspace?.[0] ?? {}) as Record<string, unknown>;
  await ctx.db.tx(async (db) => {
    await db.query(`INSERT INTO workspaces (id, name, ai_enabled, sharing_enabled, external_search_enabled) VALUES ($1,$2,$3,$4,$5)`, [
      newWs,
      opts.name ?? `${String(manifest.workspaceName ?? 'Workspace').slice(0, 60)}（復元 ${new Date().toISOString().slice(0, 10)}）`,
      wsMeta.ai_enabled !== false,
      false, // sharing is always OFF after restore
      wsMeta.external_search_enabled === true,
    ]);
    await db.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, [newWs, userId]);
    for (const [table, row] of rows) await insertRow(db, table, { ...row, workspace_id: newWs });
  });
  for (const [oldKey, buf] of files) {
    const newKey = fileKeyMap.get(oldKey)!;
    assertSafeKey(newKey);
    if (!newKey.startsWith(`ws/${newWs}/`)) throw badRequest('不正なファイルキー');
    await ctx.storage.put(newKey, buf, 'application/octet-stream');
  }
  await reindexWorkspace(ctx.db, newWs);
  await audit({ db: ctx.db, workspaceId: newWs, actor: ctx.actor }, 'backup.restore', { type: 'workspace', id: newWs }, { from: manifest.workspaceId, schemaVersion: manifest.schemaVersion, appVersion: manifest.appVersion, counts: manifest.counts });
  return { workspaceId: newWs, counts: manifest.counts };
}

// ---------------- row sanitization for restore / import
// Every column is allow-listed per table; every reference must point to a row created by the SAME payload
// (never to an existing row of any workspace); user references are rewritten to the acting user.

type Spec = { cols: string[]; refs: Record<string, { table: string; required: boolean }>; users: string[] };
const P = { table: 'projects', required: true };
const C = (required = false) => ({ table: 'candidates', required });
const S = (required = false) => ({ table: 'sources', required });
const Fct = { table: 'facts', required: false };
export const TABLE_SPECS: Record<string, Spec> = {
  projects: { cols: ['title', 'category', 'purpose', 'deadline', 'status', 'currency', 'locale', 'ai_enabled', 'fact_policy', 'default_params', 'created_by', 'created_at', 'updated_at'], refs: {}, users: ['created_by'] },
  candidates: { cols: ['name', 'provider', 'url', 'status', 'notes', 'tags', 'sort_order', 'created_at', 'updated_at'], refs: { project_id: P }, users: [] },
  sources: {
    cols: ['type', 'url', 'file_key', 'file_name', 'mime', 'size_bytes', 'title', 'publisher', 'quality', 'captured_at', 'published_at', 'retrieved_at', 'hash', 'status', 'ai_enabled', 'extracted_text', 'pages', 'error', 'injection_flags', 'created_by', 'created_at', 'deleted_at'],
    refs: { project_id: P, candidate_id: C() },
    users: ['created_by'],
  },
  attributes: { cols: ['key', 'display_name', 'type', 'unit', 'category', 'aliases', 'group_name', 'sort_order', 'origin', 'status', 'created_at'], refs: { project_id: P }, users: [] },
  normalization_rules: { cols: ['kind', 'pattern', 'attribute_key', 'version', 'active', 'created_by', 'created_at'], refs: { project_id: P }, users: ['created_by'] },
  facts: {
    cols: ['attribute_key', 'raw_label', 'raw_value', 'normalized_value', 'unit', 'issue', 'kind', 'source_range', 'confidence', 'review_state', 'extracted_by', 'created_by', 'reviewed_by', 'reviewed_at', 'note', 'created_at'],
    refs: { project_id: P, candidate_id: C(true), source_id: S(true), superseded_by: Fct },
    users: ['created_by', 'reviewed_by'],
  },
  price_snapshots: {
    cols: ['amount', 'currency', 'tax', 'shipping', 'billing_period', 'contract_months', 'per_seat', 'seats', 'captured_at', 'fx_rate', 'fx_base', 'fx_source', 'fx_at', 'note', 'created_by', 'created_at'],
    refs: { project_id: P, candidate_id: C(true), source_id: S(), fact_id: Fct },
    users: ['created_by'],
  },
  criteria: { cols: ['name', 'description', 'weight', 'direction', 'must_have', 'target', 'linked_attributes', 'origin', 'status', 'sort_order', 'created_at'], refs: { project_id: P }, users: [] },
  scenarios: { cols: ['name', 'description', 'weights', 'must_haves', 'params', 'sort_order', 'created_at'], refs: { project_id: P }, users: [] },
  questions: {
    cols: ['attribute_key', 'text', 'status', 'answer', 'created_by', 'created_at', 'answered_at'],
    refs: { project_id: P, candidate_id: C(), answer_source_id: S(), answer_fact_id: Fct },
    users: ['created_by'],
  },
  decisions: {
    cols: ['reason', 'assumptions', 'expected_outcome', 'review_date', 'actual_result', 'lessons', 'status', 'decided_by', 'decided_at', 'reviewed_at', 'created_at'],
    refs: { project_id: P, chosen_candidate_id: C(), scenario_id: { table: 'scenarios', required: false } },
    users: ['decided_by'],
  },
  briefs: { cols: ['version', 'content', 'review_state', 'created_by', 'created_at'], refs: { project_id: P }, users: ['created_by'] },
  comments: { cols: ['entity_type', 'body', 'author_id', 'created_at'], refs: { project_id: P }, users: ['author_id'] },
  user_notes: { cols: ['body', 'created_by', 'created_at'], refs: { project_id: P, candidate_id: C() }, users: ['created_by'] },
  audit_log: { cols: ['actor_type', 'action', 'entity_type', 'detail', 'created_at'], refs: { project_id: { table: 'projects', required: false } }, users: [] },
};
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeRows(
  data: Record<string, unknown[]>,
  tables: readonly string[],
  opts: { userId: string; fileKeyMap?: Map<string, string>; mode: 'restore' | 'import' },
): [string, Record<string, unknown>][] {
  const maps = new Map<string, Map<string, string>>();
  const all = new Map<string, string>();
  for (const t of tables) {
    const m = new Map<string, string>();
    const rows = data[t] ?? [];
    if (!Array.isArray(rows)) throw badRequest(`不正なデータ: ${t}`);
    for (const r of rows as Record<string, unknown>[]) {
      const id = String(r?.id ?? '');
      if (!UUID_ONLY.test(id) || all.has(id.toLowerCase())) throw badRequest(`不正なID: ${t}`);
      const nid = newId();
      m.set(id.toLowerCase(), nid);
      all.set(id.toLowerCase(), nid);
    }
    maps.set(t, m);
  }
  // JSON payload columns may mention ids (scenario weights keys, brief evidence): rewrite known ones, leave others inert
  const remapJson = (v: unknown) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v).replace(UUID_RE, (x) => all.get(x.toLowerCase()) ?? x)));
  const out: [string, Record<string, unknown>][] = [];
  for (const t of tables) {
    const spec = TABLE_SPECS[t];
    if (!spec) continue;
    for (const raw of (data[t] ?? []) as Record<string, unknown>[]) {
      const row: Record<string, unknown> = { id: maps.get(t)!.get(String(raw.id).toLowerCase()) };
      for (const col of spec.cols) if (col in raw) row[col] = typeof raw[col] === 'object' && raw[col] !== null && !Array.isArray(raw[col]) ? remapJson(raw[col]) : raw[col];
      for (const [col, ref] of Object.entries(spec.refs)) {
        const v = raw[col];
        if (v === null || v === undefined || v === '') {
          if (ref.required) throw badRequest(`参照が不足しています: ${t}.${col}`);
          row[col] = null;
          continue;
        }
        const mapped = maps.get(ref.table)?.get(String(v).toLowerCase());
        if (!mapped) throw badRequest(`ファイル外のデータを参照しています: ${t}.${col}`);
        row[col] = mapped;
      }
      for (const col of spec.users) if (row[col]) row[col] = opts.userId;
      if (t === 'comments') {
        const target = all.get(String(raw.entity_id ?? '').toLowerCase());
        if (!target) continue; // comments on unknown entities are dropped
        row.entity_id = target;
      }
      if (t === 'audit_log') {
        row.actor_id = null;
        row.entity_id = all.get(String(raw.entity_id ?? '').toLowerCase()) ?? null;
      }
      if (t === 'sources') row.file_key = row.file_key ? (opts.fileKeyMap?.get(String(row.file_key)) ?? null) : null;
      if (t === 'facts' && row.kind === 'opinion' && row.review_state === 'confirmed') row.review_state = 'candidate';
      if (opts.mode === 'import') {
        // an import is a template: human decisions are never imported
        if (t === 'candidates' && row.status === 'chosen') row.status = 'considering';
        if (t === 'decisions') Object.assign(row, { status: 'draft', decided_by: null, decided_at: null, reviewed_at: null });
        if (t === 'sources' && row.type !== 'manual' && row.status !== 'deleted') row.status = 'ready';
      }
      out.push([t, row]);
    }
  }
  return out;
}

export async function reindexWorkspace(db: Ctx['db'], workspaceId: string) {
  await db.query(`DELETE FROM search_index WHERE workspace_id = $1`, [workspaceId]);
  for (const p of await db.query(`SELECT id, title, purpose, category FROM projects WHERE workspace_id = $1`, [workspaceId])) await indexEntity(db, workspaceId, 'project', p.id, p.id, p.title, `${p.purpose ?? ''} ${p.category ?? ''}`);
  for (const c of await db.query(`SELECT id, project_id, name, provider, notes FROM candidates WHERE workspace_id = $1`, [workspaceId])) await indexEntity(db, workspaceId, 'candidate', c.id, c.project_id, c.name, `${c.provider ?? ''} ${c.notes ?? ''}`);
  for (const s of await db.query(`SELECT id, project_id, title, url, extracted_text FROM sources WHERE workspace_id = $1 AND status <> 'deleted'`, [workspaceId]))
    await indexEntity(db, workspaceId, 'source', s.id, s.project_id, s.title ?? s.url ?? 'source', `${s.url ?? ''}\n${s.extracted_text ?? ''}`);
  for (const f of await db.query(`SELECT f.id, f.project_id, f.raw_label, f.raw_value, f.source_range FROM facts f JOIN sources s ON s.id = f.source_id WHERE f.workspace_id = $1 AND s.status <> 'deleted'`, [workspaceId]))
    await indexEntity(db, workspaceId, 'fact', f.id, f.project_id, `${f.raw_label}: ${f.raw_value}`, f.source_range?.context ?? '');
  for (const q of await db.query(`SELECT id, project_id, text, answer FROM questions WHERE workspace_id = $1`, [workspaceId])) await indexEntity(db, workspaceId, 'question', q.id, q.project_id, q.text, q.answer ?? '');
  for (const d of await db.query(`SELECT id, project_id, reason, assumptions FROM decisions WHERE workspace_id = $1`, [workspaceId])) await indexEntity(db, workspaceId, 'decision', d.id, d.project_id, `判断: ${String(d.reason).slice(0, 80)}`, `${d.reason} ${d.assumptions ?? ''}`);
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
  if (!payload.project || typeof payload.project !== 'object') throw badRequest('project がありません');
  const tables = ['projects', 'candidates', 'sources', 'attributes', 'normalization_rules', 'facts', 'price_snapshots', 'criteria', 'scenarios', 'questions', 'decisions'] as const;
  const rows = sanitizeRows({ ...payload, projects: [payload.project] }, tables, { userId: ctx.actor.userId ?? '', mode: 'import' });
  const newProjectId = rows.find(([t]) => t === 'projects')![1].id as string;
  await ctx.db.tx(async (db) => {
    for (const [table, row] of rows) {
      if (table === 'projects') Object.assign(row, { title: `${String(row.title ?? '').slice(0, 100)}（インポート）`, created_by: ctx.actor.userId });
      await insertRow(db, table, { ...row, workspace_id: ctx.workspaceId });
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
