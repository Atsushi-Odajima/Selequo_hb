// Read-only guest share links (optional; OFF by default per workspace) and audit log listing.

import { newId, newToken, sha256 } from '../auth/crypto';
import type { Db } from '../db';
import { audit, badRequest, getProjectRow, mapRows, need, notFound, type Ctx } from './core';

export async function createShareLink(ctx: Ctx, projectId: string, days = 14) {
  need(ctx, 'admin');
  await getProjectRow(ctx, projectId);
  const ws = await ctx.db.one<{ sharing_enabled: boolean }>(`SELECT sharing_enabled FROM workspaces WHERE id = $1`, [ctx.workspaceId]);
  if (!ws?.sharing_enabled) throw badRequest('このワークスペースでは共有リンクが無効です（設定でONにできます）');
  const token = newToken('shr_');
  const id = newId();
  const expires = new Date(Date.now() + Math.min(Math.max(days, 1), 90) * 86400000);
  await ctx.db.query(`INSERT INTO share_links (id, workspace_id, project_id, token_hash, created_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ctx.workspaceId, projectId, sha256(token), ctx.actor.userId, expires]);
  await audit(ctx, 'share.create', { type: 'share_link', id, projectId }, { expiresAt: expires.toISOString() });
  return { id, token, url: `${ctx.config.publicUrl}/s/${token}`, expiresAt: expires.toISOString() };
}

export async function listShareLinks(ctx: Ctx, projectId: string) {
  need(ctx, 'admin');
  return mapRows(await ctx.db.query(`SELECT id, created_at, expires_at, revoked_at FROM share_links WHERE project_id = $1 AND workspace_id = $2 ORDER BY created_at DESC`, [projectId, ctx.workspaceId]));
}

export async function revokeShareLink(ctx: Ctx, id: string) {
  need(ctx, 'admin');
  const row = await ctx.db.one(`SELECT project_id FROM share_links WHERE id = $1 AND workspace_id = $2`, [id, ctx.workspaceId]);
  if (!row) throw notFound('共有リンク');
  await ctx.db.query(`UPDATE share_links SET revoked_at = now() WHERE id = $1`, [id]);
  await audit(ctx, 'share.revoke', { type: 'share_link', id, projectId: row.project_id });
}

export async function resolveShareToken(db: Db, token: string) {
  return db.one<{ workspace_id: string; project_id: string; id: string }>(
    `SELECT l.id, l.workspace_id, l.project_id FROM share_links l JOIN workspaces w ON w.id = l.workspace_id WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND l.expires_at > now() AND w.sharing_enabled = true`,
    [sha256(token)],
  );
}

export async function listAudit(ctx: Ctx, opts: { projectId?: string; limit?: number } = {}) {
  need(ctx, 'reviewer');
  const params: unknown[] = [ctx.workspaceId];
  let where = 'a.workspace_id = $1';
  if (opts.projectId) {
    params.push(opts.projectId);
    where += ` AND a.project_id = $2`;
  }
  params.push(Math.min(opts.limit ?? 200, 1000));
  return mapRows(
    await ctx.db.query(
      `SELECT a.id, a.project_id, a.actor_type, a.actor_id, COALESCE(u.name, t.name) AS actor_name, a.action, a.entity_type, a.entity_id, a.detail, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN api_tokens t ON t.id = a.actor_id
        WHERE ${where} ORDER BY a.created_at DESC LIMIT $${params.length}`,
      params,
    ),
    [],
  );
}
