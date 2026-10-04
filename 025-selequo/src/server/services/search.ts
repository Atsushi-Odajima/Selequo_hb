// Cross-entity search (full-text via ILIKE + pg_trgm similarity). Indexed per workspace (ACL);
// deleting an entity removes it from the index and from embeddings.

import type { Db } from '../db';
import type { Ctx } from './core';

export type EntityType = 'project' | 'candidate' | 'source' | 'fact' | 'question' | 'decision';

export async function indexEntity(db: Db, workspaceId: string, type: EntityType, id: string, projectId: string | null, title: string, body = '') {
  await db.query(
    `INSERT INTO search_index (entity_type, entity_id, workspace_id, project_id, title, body, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, project_id = EXCLUDED.project_id, updated_at = now()`,
    [type, id, workspaceId, projectId, title.slice(0, 500), body.slice(0, 20000)],
  );
}

export async function unindexEntity(db: Db, workspaceId: string, type: EntityType, id: string) {
  await db.query(`DELETE FROM search_index WHERE entity_type = $1 AND entity_id = $2 AND workspace_id = $3`, [type, id, workspaceId]);
  await db.query(`DELETE FROM embeddings WHERE entity_type = $1 AND entity_id = $2 AND workspace_id = $3`, [type, id, workspaceId]);
}

export async function search(ctx: Ctx, q: string, opts: { types?: EntityType[]; projectId?: string; limit?: number } = {}) {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  const like = `%${query.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const params: unknown[] = [ctx.workspaceId, like, query];
  let where = `workspace_id = $1 AND (title ILIKE $2 OR body ILIKE $2 OR similarity(title || ' ' || body, $3) > 0.2)`;
  if (opts.types?.length) {
    params.push(opts.types);
    where += ` AND entity_type = ANY($${params.length})`;
  }
  if (opts.projectId) {
    params.push(opts.projectId);
    where += ` AND project_id = $${params.length}`;
  }
  params.push(Math.min(opts.limit ?? 30, 100));
  const rows = await ctx.db.query<{ entity_type: string; entity_id: string; project_id: string | null; title: string; body: string; score: number }>(
    `SELECT entity_type, entity_id, project_id, title, body,
            (CASE WHEN title ILIKE $2 THEN 1 ELSE 0 END) + similarity(title || ' ' || body, $3) AS score
       FROM search_index WHERE ${where} ORDER BY score DESC, updated_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => {
    const idx = r.body.toLowerCase().indexOf(query.toLowerCase());
    const snippet = idx >= 0 ? r.body.slice(Math.max(0, idx - 60), idx + query.length + 60) : r.body.slice(0, 120);
    return { type: r.entity_type, id: r.entity_id, projectId: r.project_id, title: r.title, snippet, score: Number(r.score) };
  });
}
