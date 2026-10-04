// Service-layer primitives: request context, authorization, audit, row mapping.

import type { Config } from '../config';
import type { Db } from '../db';
import type { Storage } from '../storage';
import type { Fetcher } from '../import/fetcher';
import type { AIProvider } from '../ai/provider';
import { type Role, roleAtLeast } from '../../shared/types';
import { newId } from '../auth/crypto';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what = 'リソース') => new HttpError(404, 'not_found', `${what}が見つかりません`);
export const forbidden = (msg = '権限がありません') => new HttpError(403, 'forbidden', msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);

export interface Deps {
  db: Db;
  storage: Storage;
  fetcher: Fetcher;
  config: Config;
  aiProvider: AIProvider | null; // configured provider (may be null = none)
  jobs: { enqueue(db: Db, workspaceId: string, type: string, payload: unknown): Promise<string>; kick(): void };
}

export interface Actor {
  type: 'user' | 'token' | 'share' | 'system';
  userId: string | null;
  tokenId?: string;
  name: string;
}

export interface Ctx extends Deps {
  actor: Actor;
  workspaceId: string;
  role: Role;
  scopes: ('read' | 'write')[];
}

/** Require a minimum role (and write scope for any mutation beyond viewer). */
export function need(ctx: Ctx, min: Role) {
  if (!roleAtLeast(ctx.role, min)) throw forbidden(`この操作には ${min} 以上の権限が必要です`);
  if (min !== 'viewer' && !ctx.scopes.includes('write')) throw forbidden('このトークンには書き込み権限（write scope）がありません');
}

export async function audit(
  ctx: Pick<Ctx, 'db' | 'workspaceId' | 'actor'>,
  action: string,
  entity: { type?: string; id?: string; projectId?: string | null } = {},
  detail: Record<string, unknown> = {},
) {
  await ctx.db.query(
    `INSERT INTO audit_log (id, workspace_id, project_id, actor_type, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [newId(), ctx.workspaceId, entity.projectId ?? null, ctx.actor.type, ctx.actor.tokenId ?? ctx.actor.userId, action, entity.type ?? null, entity.id ?? null, JSON.stringify(detail)],
  );
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const NUMERIC_KEYS = new Set(['weight', 'amount', 'shipping', 'fxRate', 'confidence', 'sizeBytes']);

/** snake_case row → camelCase object, Dates → ISO strings, numeric strings → numbers. */
export function mapRow<T>(row: Record<string, unknown>, omit: string[] = ['workspace_id']): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (omit.includes(k)) continue;
    const ck = camel(k);
    if (v instanceof Date) out[ck] = ck === 'deadline' || ck === 'reviewDate' ? v.toISOString().slice(0, 10) : v.toISOString();
    else if (NUMERIC_KEYS.has(ck) && v !== null && v !== undefined) out[ck] = Number(v);
    else out[ck] = v;
  }
  return out as T;
}

export const mapRows = <T>(rows: Record<string, unknown>[], omit?: string[]) => rows.map((r) => mapRow<T>(r, omit));

/** Ensure a project belongs to the caller's workspace (tenant isolation). */
export async function getProjectRow(ctx: Ctx, projectId: string) {
  const p = await ctx.db.one(`SELECT * FROM projects WHERE id = $1 AND workspace_id = $2`, [projectId, ctx.workspaceId]);
  if (!p) throw notFound('プロジェクト');
  return p;
}

export async function assertInProject(ctx: Ctx, table: 'candidates' | 'sources' | 'facts' | 'criteria' | 'scenarios' | 'questions' | 'attributes' | 'decisions' | 'briefs' | 'price_snapshots' | 'comments' | 'user_notes', id: string, projectId?: string) {
  const row = await ctx.db.one(`SELECT * FROM ${table} WHERE id = $1 AND workspace_id = $2`, [id, ctx.workspaceId]);
  if (!row || (projectId && row.project_id !== projectId)) throw notFound();
  return row;
}

export function aiAllowed(ws: { ai_enabled: boolean }, project: { ai_enabled: boolean }, source?: { ai_enabled: boolean } | null) {
  return ws.ai_enabled && project.ai_enabled && (source ? source.ai_enabled : true);
}
