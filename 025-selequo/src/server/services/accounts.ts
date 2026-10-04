// Users, sessions, workspaces, memberships (RBAC), invitations and API tokens.

import { z } from 'zod';
import type { Db } from '../db';
import { hashPassword, newId, newToken, sha256, verifyPassword } from '../auth/crypto';
import { ROLES, type Role, roleAtLeast } from '../../shared/types';
import { audit, badRequest, forbidden, HttpError, mapRow, mapRows, need, notFound, type Ctx } from './core';

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export const SignupInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(200),
  workspaceName: z.string().trim().min(1).max(80).optional(),
});

export async function signup(db: Db, input: z.infer<typeof SignupInput>) {
  const exists = await db.one(`SELECT id FROM users WHERE email = $1`, [input.email]);
  if (exists) throw new HttpError(409, 'email_taken', 'このメールアドレスは登録済みです');
  const userId = newId();
  const wsId = newId();
  await db.tx(async (tx) => {
    await tx.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)`, [userId, input.email, input.name, await hashPassword(input.password)]);
    await tx.query(`INSERT INTO workspaces (id, name) VALUES ($1,$2)`, [wsId, input.workspaceName ?? `${input.name}のワークスペース`]);
    await tx.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, [wsId, userId]);
    await tx.query(`INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id) VALUES ($1,$2,'user',$3,'workspace.create','workspace',$2)`, [newId(), wsId, userId]);
  });
  return { userId, workspaceId: wsId };
}

export async function login(db: Db, email: string, password: string) {
  const u = await db.one<{ id: string; password_hash: string }>(`SELECT id, password_hash FROM users WHERE email = $1`, [email.trim().toLowerCase()]);
  // constant-ish time: always run a verification
  const ok = u ? await verifyPassword(password, u.password_hash) : await verifyPassword(password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!u || !ok) throw new HttpError(401, 'invalid_credentials', 'メールアドレスまたはパスワードが正しくありません');
  return createSession(db, u.id);
}

export async function createSession(db: Db, userId: string) {
  const token = newToken();
  const csrf = newToken();
  await db.query(`INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES ($1,$2,$3,$4)`, [sha256(token), userId, csrf, new Date(Date.now() + SESSION_TTL_MS)]);
  return { token, csrf };
}

export async function sessionUser(db: Db, token: string) {
  return db.one<{ user_id: string; csrf_token: string; email: string; name: string }>(
    `SELECT s.user_id, s.csrf_token, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
}

export async function logout(db: Db, token: string) {
  await db.query(`DELETE FROM sessions WHERE id = $1`, [sha256(token)]);
}

export async function listWorkspaces(db: Db, userId: string) {
  return mapRows<{ id: string; name: string; role: Role; isSample: boolean }>(
    await db.query(`SELECT w.id, w.name, w.is_sample, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY w.created_at`, [userId]),
  );
}

export async function membershipRole(db: Db, workspaceId: string, userId: string): Promise<Role | null> {
  const m = await db.one<{ role: Role }>(`SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
  return m?.role ?? null;
}

export async function getWorkspace(ctx: Ctx) {
  const w = await ctx.db.one(`SELECT * FROM workspaces WHERE id = $1`, [ctx.workspaceId]);
  if (!w) throw notFound('ワークスペース');
  return { ...mapRow<Record<string, unknown>>(w, []), role: ctx.role };
}

export const WorkspaceSettingsInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  aiEnabled: z.boolean().optional(),
  sharingEnabled: z.boolean().optional(),
  externalSearchEnabled: z.boolean().optional(),
});

export async function updateWorkspace(ctx: Ctx, input: z.infer<typeof WorkspaceSettingsInput>) {
  need(ctx, 'admin');
  const cur = await ctx.db.one(`SELECT * FROM workspaces WHERE id = $1`, [ctx.workspaceId]);
  if (!cur) throw notFound();
  await ctx.db.query(`UPDATE workspaces SET name = $2, ai_enabled = $3, sharing_enabled = $4, external_search_enabled = $5 WHERE id = $1`, [
    ctx.workspaceId,
    input.name ?? cur.name,
    input.aiEnabled ?? cur.ai_enabled,
    input.sharingEnabled ?? cur.sharing_enabled,
    input.externalSearchEnabled ?? cur.external_search_enabled,
  ]);
  if (input.sharingEnabled === false) await ctx.db.query(`UPDATE share_links SET revoked_at = now() WHERE workspace_id = $1 AND revoked_at IS NULL`, [ctx.workspaceId]);
  await audit(ctx, 'workspace.settings', { type: 'workspace', id: ctx.workspaceId }, input);
  return getWorkspace(ctx);
}

export async function createWorkspace(db: Db, userId: string, name: string) {
  const id = newId();
  await db.tx(async (tx) => {
    await tx.query(`INSERT INTO workspaces (id, name) VALUES ($1,$2)`, [id, name]);
    await tx.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, [id, userId]);
  });
  return id;
}

// ---- members & invitations

export async function listMembers(ctx: Ctx) {
  need(ctx, 'viewer');
  return mapRows(await ctx.db.query(`SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.created_at`, [ctx.workspaceId]));
}

const RoleSchema = z.enum(ROLES);

export async function setMemberRole(ctx: Ctx, userId: string, role: Role) {
  need(ctx, 'admin');
  RoleSchema.parse(role);
  const target = await ctx.db.one<{ role: Role }>(`SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [ctx.workspaceId, userId]);
  if (!target) throw notFound('メンバー');
  // only owners can grant/revoke owner or admin; admins cannot change owners
  if ((role === 'owner' || target.role === 'owner' || role === 'admin' || target.role === 'admin') && ctx.role !== 'owner') throw forbidden('Owner/Adminの変更はOwnerのみ可能です');
  if (target.role === 'owner' && role !== 'owner') {
    const owners = await ctx.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE workspace_id = $1 AND role = 'owner'`, [ctx.workspaceId]);
    if ((owners?.n ?? 0) <= 1) throw badRequest('最後のOwnerは変更できません');
  }
  await ctx.db.query(`UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2`, [ctx.workspaceId, userId, role]);
  await audit(ctx, 'member.role', { type: 'user', id: userId }, { from: target.role, to: role });
}

export async function removeMember(ctx: Ctx, userId: string) {
  need(ctx, 'admin');
  const target = await ctx.db.one<{ role: Role }>(`SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [ctx.workspaceId, userId]);
  if (!target) throw notFound('メンバー');
  if (target.role === 'owner') throw badRequest('Ownerは削除できません（先にロールを変更してください）');
  if (target.role === 'admin' && ctx.role !== 'owner') throw forbidden();
  await ctx.db.query(`DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [ctx.workspaceId, userId]);
  await ctx.db.query(`UPDATE api_tokens SET revoked_at = now() WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`, [ctx.workspaceId, userId]);
  await audit(ctx, 'member.remove', { type: 'user', id: userId });
}

export async function createInvitation(ctx: Ctx, email: string, role: Role) {
  need(ctx, 'admin');
  RoleSchema.parse(role);
  if ((role === 'owner' || role === 'admin') && ctx.role !== 'owner') throw forbidden('Owner/Adminの招待はOwnerのみ可能です');
  const token = newToken('inv_');
  const id = newId();
  await ctx.db.query(`INSERT INTO invitations (id, workspace_id, email, role, token_hash, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    id,
    ctx.workspaceId,
    z.string().email().parse(email.trim().toLowerCase()),
    role,
    sha256(token),
    new Date(Date.now() + 7 * 86400000),
    ctx.actor.userId,
  ]);
  await audit(ctx, 'member.invite', { type: 'invitation', id }, { email, role });
  // No e-mail is sent by the app: the inviter shares the link (see OPERATIONS.md)
  return { id, token, url: `${ctx.config.publicUrl}/invite/${token}` };
}

export async function acceptInvitation(db: Db, userId: string, token: string) {
  const inv = await db.one<{ id: string; workspace_id: string; role: Role; email: string }>(
    `SELECT * FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  if (!inv) throw notFound('招待');
  const user = await db.one<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
  if (user?.email !== inv.email) throw forbidden('招待されたメールアドレスでログインしてください');
  await db.tx(async (tx) => {
    await tx.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [inv.workspace_id, userId, inv.role]);
    await tx.query(`UPDATE invitations SET accepted_at = now() WHERE id = $1`, [inv.id]);
    await tx.query(`INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, entity_type, entity_id) VALUES ($1,$2,'user',$3,'member.join','user',$3)`, [newId(), inv.workspace_id, userId]);
  });
  return { workspaceId: inv.workspace_id };
}

// ---- API tokens (MCP / integrations)

export async function createApiToken(ctx: Ctx, name: string, scopes: ('read' | 'write')[]) {
  need(ctx, 'viewer');
  if (ctx.actor.type !== 'user' || !ctx.actor.userId) throw forbidden('APIトークンはログインユーザーのみ作成できます');
  if (scopes.includes('write') && !roleAtLeast(ctx.role, 'reviewer')) throw forbidden('Viewerは書き込みトークンを作成できません');
  const token = newToken('slq_');
  const id = newId();
  await ctx.db.query(`INSERT INTO api_tokens (id, workspace_id, user_id, name, token_hash, scopes) VALUES ($1,$2,$3,$4,$5,$6)`, [
    id,
    ctx.workspaceId,
    ctx.actor.userId,
    z.string().trim().min(1).max(60).parse(name),
    sha256(token),
    [...new Set(scopes)],
  ]);
  await audit(ctx, 'token.create', { type: 'api_token', id }, { scopes });
  return { id, token };
}

export async function listApiTokens(ctx: Ctx) {
  return mapRows(
    await ctx.db.query(`SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM api_tokens WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [ctx.workspaceId, ctx.actor.userId]),
  );
}

export async function revokeApiToken(ctx: Ctx, id: string) {
  const t = await ctx.db.one(`SELECT user_id FROM api_tokens WHERE id = $1 AND workspace_id = $2`, [id, ctx.workspaceId]);
  if (!t) throw notFound('トークン');
  if (t.user_id !== ctx.actor.userId) need(ctx, 'admin');
  await ctx.db.query(`UPDATE api_tokens SET revoked_at = now() WHERE id = $1`, [id]);
  await audit(ctx, 'token.revoke', { type: 'api_token', id });
}

/** Resolve a bearer token to a context base. Token permissions never exceed the user's current role. */
export async function resolveApiToken(db: Db, token: string) {
  const t = await db.one<{ id: string; workspace_id: string; user_id: string; scopes: string[]; name: string; uname: string }>(
    `SELECT t.id, t.workspace_id, t.user_id, t.scopes, t.name, u.name AS uname FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [sha256(token)],
  );
  if (!t) return null;
  const role = await membershipRole(db, t.workspace_id, t.user_id);
  if (!role) return null;
  await db.query(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [t.id]);
  return { tokenId: t.id, workspaceId: t.workspace_id, userId: t.user_id, userName: t.uname, role, scopes: t.scopes.filter((s): s is 'read' | 'write' => s === 'read' || s === 'write') };
}
