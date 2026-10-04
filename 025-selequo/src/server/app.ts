// Fastify application: security middleware, auth (session cookie + CSRF, bearer API tokens), REST API, MCP endpoint.

import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError, z } from 'zod';
import type { Config } from './config';
import type { Db } from './db';
import { LocalDiskStorage, MemoryStorage, type Storage, verifyFileSignature } from './storage';
import { Fetcher } from './import/fetcher';
import { AnthropicProvider, MockProvider, type AIProvider } from './ai/provider';
import { JobRunner } from './jobs';
import { HttpError, type Actor, type Ctx, type Deps, badRequest, forbidden } from './services/core';
import * as A from './services/accounts';
import * as P from './services/projects';
import * as S from './services/sources';
import * as F from './services/facts';
import * as C from './services/comparison';
import * as D from './services/decisions';
import * as Q from './services/assistant';
import * as B from './services/backup';
import * as SH from './services/share';
import { search } from './services/search';
import { registerMcp } from '../mcp/http';
import type { Role } from '../shared/types';

export interface BuildOptions {
  config: Config;
  db: Db;
  storage?: Storage;
  fetcher?: Fetcher;
  aiProvider?: AIProvider | null;
  startJobs?: boolean;
  logger?: boolean;
}

export const SESSION_COOKIE = 'slq_session';

export async function buildApp(opts: BuildOptions) {
  const { config, db } = opts;
  const storage = opts.storage ?? (config.env === 'test' ? new MemoryStorage() : new LocalDiskStorage(path.resolve(config.dataDir, 'files')));
  const fetcher = opts.fetcher ?? new Fetcher({ allowPorts: config.fetchAllowPorts, maxBytes: config.maxFetchBytes, fixturesDir: config.fetchFixturesDir });
  const aiProvider =
    opts.aiProvider !== undefined
      ? opts.aiProvider
      : config.aiProvider === 'anthropic' && config.anthropicApiKey
        ? new AnthropicProvider(config.anthropicApiKey, config.anthropicModel)
        : config.aiProvider === 'mock' && config.env !== 'production'
          ? new MockProvider()
          : null;

  const deps: Deps = {
    db,
    storage,
    fetcher,
    config,
    aiProvider,
    jobs: { enqueue: (d, ws, t, p) => runner.enqueue(d, ws, t, p), kick: () => runner.kick() },
  };
  const systemCtx = (workspaceId: string): Ctx => ({ ...deps, workspaceId, role: 'owner', scopes: ['read', 'write'], actor: { type: 'system', userId: null, name: 'system' } });
  const runner = new JobRunner(db, {
    process_source: async (job) => S.processSource(systemCtx(job.workspaceId), job.payload.sourceId),
  });
  if (opts.startJobs !== false) runner.start();

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024, trustProxy: config.env === 'production' });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: config.env === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.env === 'production',
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: config.env === 'test' ? () => true : undefined });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'validation', message: '入力内容を確認してください', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.code ?? 'error', message: e.statusCode === 413 ? 'ファイルサイズが上限を超えています' : e.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'サーバーエラーが発生しました' });
  });

  // ---------- auth helpers
  async function userFromCookie(req: FastifyRequest) {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return null;
    const s = await A.sessionUser(db, token);
    return s ? { token, ...s } : null;
  }
  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
  };

  async function ctxFor(req: FastifyRequest, workspaceId: string): Promise<Ctx> {
    const tok = bearer(req);
    if (tok) {
      const t = await A.resolveApiToken(db, tok);
      if (!t || t.workspaceId !== workspaceId) throw new HttpError(401, 'unauthorized', 'トークンが無効です');
      return { ...deps, workspaceId, role: t.role, scopes: t.scopes, actor: { type: 'token', userId: t.userId, tokenId: t.tokenId, name: `${t.userName}（APIトークン）` } };
    }
    const u = await userFromCookie(req);
    if (!u) throw new HttpError(401, 'unauthorized', 'ログインしてください');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-csrf-token'] !== u.csrf_token) throw new HttpError(403, 'csrf', 'CSRFトークンが無効です。ページを再読み込みしてください');
    const role = await A.membershipRole(db, workspaceId, u.user_id);
    if (!role) throw new HttpError(404, 'not_found', 'ワークスペースが見つかりません'); // do not reveal existence
    return { ...deps, workspaceId, role, scopes: ['read', 'write'], actor: { type: 'user', userId: u.user_id, name: u.name } };
  }

  type Req = FastifyRequest & { params: Record<string, string>; query: Record<string, string>; body: any };
  type H = (ctx: Ctx, req: Req, reply: FastifyReply) => Promise<unknown>;
  const ws = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, handler: H, config: Record<string, unknown> = {}) =>
    app.route({
      method,
      url: `/api/w/:ws${url}`,
      config,
      handler: async (req, reply) => {
        const r = req as Req;
        const ctx = await ctxFor(r, r.params.ws);
        const out = await handler(ctx, r, reply);
        if (reply.sent) return;
        return out === undefined ? { ok: true } : out;
      },
    });
  const authLimit = { rateLimit: { max: config.env === 'test' ? 10_000 : 20, timeWindow: '1 minute' } };
  const importLimit = { rateLimit: { max: config.env === 'test' ? 10_000 : 60, timeWindow: '1 minute' } };

  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: A.SESSION_TTL_MS / 1000 });

  // ---------- public / auth
  app.get('/api/health', async () => ({ ok: true, version: config.appVersion, db: db.kind, ai: aiProvider?.id ?? 'none' }));

  app.post('/api/auth/signup', { config: authLimit }, async (req, reply) => {
    if (!config.signupEnabled) throw forbidden('新規登録は無効です');
    const input = A.SignupInput.parse(req.body);
    const r = await A.signup(db, input);
    const s = await A.createSession(db, r.userId);
    setSession(reply, s.token);
    return { ...r, csrf: s.csrf };
  });
  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    const { email, password } = z.object({ email: z.string().max(200), password: z.string().max(200) }).parse(req.body);
    const s = await A.login(db, email, password);
    setSession(reply, s.token);
    return { ok: true, csrf: s.csrf };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const u = await userFromCookie(req);
    if (u) {
      if (req.headers['x-csrf-token'] !== u.csrf_token) throw new HttpError(403, 'csrf', 'CSRFトークンが無効です');
      await A.logout(db, u.token);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/auth/me', async (req) => {
    const u = await userFromCookie(req);
    if (!u) throw new HttpError(401, 'unauthorized', 'ログインしてください');
    return { user: { id: u.user_id, email: u.email, name: u.name }, csrf: u.csrf_token, workspaces: await A.listWorkspaces(db, u.user_id), ai: { configured: !!aiProvider, provider: aiProvider?.id ?? null } };
  });
  async function requireUser(req: FastifyRequest) {
    const u = await userFromCookie(req);
    if (!u) throw new HttpError(401, 'unauthorized', 'ログインしてください');
    if (req.headers['x-csrf-token'] !== u.csrf_token) throw new HttpError(403, 'csrf', 'CSRFトークンが無効です');
    return u;
  }
  app.post('/api/workspaces', async (req) => {
    const u = await requireUser(req);
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    return { id: await A.createWorkspace(db, u.user_id, name) };
  });
  app.post('/api/invitations/:token/accept', async (req) => {
    const u = await requireUser(req);
    return A.acceptInvitation(db, u.user_id, (req.params as { token: string }).token);
  });
  app.post('/api/restore', { config: importLimit }, async (req) => {
    const u = await requireUser(req);
    const file = await req.file();
    if (!file) throw badRequest('バックアップファイルを指定してください');
    const buf = new Uint8Array(await file.toBuffer());
    const actor: Actor = { type: 'user', userId: u.user_id, name: u.name };
    return B.restoreBackup({ ...deps, actor, scopes: ['read', 'write'] }, buf);
  });

  // signed file download (short-lived HMAC URL)
  app.get('/api/files', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (!q.key || !verifyFileSignature(config.secret, q.key, q.exp, q.sig)) throw new HttpError(403, 'forbidden', 'リンクの有効期限が切れています');
    const src = await db.one<{ mime: string; file_name: string | null }>(`SELECT mime, file_name FROM sources WHERE file_key = $1 AND status <> 'deleted'`, [q.key]);
    if (!src) throw new HttpError(404, 'not_found', 'ファイルが見つかりません');
    const data = await storage.get(q.key);
    if (!data) throw new HttpError(404, 'not_found', 'ファイルが見つかりません');
    const isImage = /^image\//.test(src.mime) || src.mime === 'application/pdf';
    reply
      .header('content-type', /html/.test(src.mime) ? 'text/plain; charset=utf-8' : src.mime) // stored HTML is never rendered as HTML
      .header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=300')
      .header('content-disposition', `${isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(src.file_name ?? 'source')}`);
    return reply.send(Buffer.from(data));
  });

  // guest read-only share
  app.get('/api/share/:token', async (req) => {
    const link = await SH.resolveShareToken(db, (req.params as { token: string }).token);
    if (!link) throw new HttpError(404, 'not_found', '共有リンクが無効です');
    const ctx: Ctx = { ...deps, workspaceId: link.workspace_id, role: 'viewer', scopes: ['read'], actor: { type: 'share', userId: null, name: 'guest' } };
    const project = await P.getProject(ctx, link.project_id);
    const compare = await C.getCompare(ctx, link.project_id);
    const brief = await D.buildProjectBrief(ctx, link.project_id);
    return { project: { title: project.title, purpose: project.purpose, category: project.category }, compare, brief };
  });

  // ---------- workspace
  ws('GET', '', (ctx) => A.getWorkspace(ctx));
  ws('PATCH', '', (ctx, req) => A.updateWorkspace(ctx, A.WorkspaceSettingsInput.parse(req.body)));
  ws('GET', '/members', (ctx) => A.listMembers(ctx));
  ws('PATCH', '/members/:userId', async (ctx, req) => A.setMemberRole(ctx, req.params.userId, z.object({ role: z.string() }).parse(req.body).role as Role));
  ws('DELETE', '/members/:userId', (ctx, req) => A.removeMember(ctx, req.params.userId));
  ws('POST', '/invitations', (ctx, req) => {
    const b = z.object({ email: z.string(), role: z.string() }).parse(req.body);
    return A.createInvitation(ctx, b.email, b.role as Role);
  });
  ws('GET', '/tokens', (ctx) => A.listApiTokens(ctx));
  ws('POST', '/tokens', (ctx, req) => {
    const b = z.object({ name: z.string(), scopes: z.array(z.enum(['read', 'write'])).min(1) }).parse(req.body);
    return A.createApiToken(ctx, b.name, b.scopes);
  });
  ws('DELETE', '/tokens/:id', (ctx, req) => A.revokeApiToken(ctx, req.params.id));
  ws('GET', '/audit', (ctx, req) => SH.listAudit(ctx, { projectId: req.query.projectId, limit: Number(req.query.limit ?? 200) }));
  ws('GET', '/search', (ctx, req) => search(ctx, String(req.query.q ?? ''), { projectId: req.query.projectId, types: req.query.type ? (req.query.type.split(',') as never) : undefined }));
  ws('GET', '/reviews/due', (ctx) => D.dueReviews(ctx));
  ws('GET', '/ai-usage', async (ctx, req) => {
    const params: unknown[] = [ctx.workspaceId];
    let where = 'workspace_id = $1';
    if (req.query.projectId) {
      params.push(req.query.projectId);
      where += ' AND project_id = $2';
    }
    const rows = await ctx.db.query(`SELECT provider, purpose, count(*)::int AS calls, sum(input_chars)::int AS input_chars, sum(output_chars)::int AS output_chars FROM ai_calls WHERE ${where} GROUP BY provider, purpose`, params);
    return { configured: aiProvider?.id ?? null, usage: rows };
  });
  ws('GET', '/backup', async (ctx, _req, reply) => {
    const zip = await B.createBackup(ctx);
    reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="selequo-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    return reply.send(Buffer.from(zip));
  });
  ws('POST', '/projects/import', (ctx, req) => B.importProjectJson(ctx, req.body as Record<string, unknown>), importLimit);

  // ---------- projects
  ws('GET', '/projects', (ctx) => P.listProjects(ctx));
  ws('POST', '/projects', (ctx, req) => P.createProject(ctx, P.ProjectInput.parse(req.body)));
  ws('GET', '/projects/:pid', (ctx, req) => P.getProject(ctx, req.params.pid));
  ws('PATCH', '/projects/:pid', (ctx, req) => P.updateProject(ctx, req.params.pid, P.ProjectInput.partial().parse(req.body)));
  ws('DELETE', '/projects/:pid', (ctx, req) => P.deleteProject(ctx, req.params.pid));
  ws('GET', '/projects/:pid/export.json', async (ctx, req, reply) => {
    const out = await B.exportProjectJson(ctx, req.params.pid);
    reply.header('content-disposition', `attachment; filename="selequo-project.json"`);
    return out;
  });

  ws('GET', '/projects/:pid/candidates', (ctx, req) => P.listCandidates(ctx, req.params.pid));
  ws('POST', '/projects/:pid/candidates', (ctx, req) => P.createCandidate(ctx, req.params.pid, P.CandidateInput.parse(req.body)));
  ws('PATCH', '/candidates/:id', (ctx, req) => P.updateCandidate(ctx, req.params.id, P.CandidateInput.partial().parse(req.body)));
  ws('DELETE', '/candidates/:id', (ctx, req) => P.deleteCandidate(ctx, req.params.id));

  // sources
  ws('GET', '/projects/:pid/sources', (ctx, req) => S.listSources(ctx, req.params.pid));
  ws('POST', '/projects/:pid/sources/url', (ctx, req) => S.addUrlSource(ctx, req.params.pid, S.UrlSourceInput.parse(req.body)), importLimit);
  ws('POST', '/projects/:pid/sources/text', (ctx, req) => S.addTextSource(ctx, req.params.pid, S.TextSourceInput.parse(req.body)), importLimit);
  ws(
    'POST',
    '/projects/:pid/sources/file',
    async (ctx, req) => {
      const file = await req.file();
      if (!file) throw badRequest('ファイルを指定してください');
      const data = new Uint8Array(await file.toBuffer());
      const fields = Object.fromEntries(Object.entries(file.fields).flatMap(([k, v]) => (v && typeof v === 'object' && 'value' in v ? [[k, (v as { value: string }).value]] : [])));
      const meta = {
        candidateId: fields.candidateId || null,
        kind: fields.kind || 'auto',
        quality: fields.quality || undefined,
        title: fields.title || null,
        capturedAt: fields.capturedAt || null,
        url: fields.url || null,
        aiEnabled: fields.aiEnabled ? fields.aiEnabled === 'true' : undefined,
      };
      return S.addFileSource(ctx, req.params.pid, { data, fileName: file.filename }, meta as never);
    },
    importLimit,
  );
  ws('GET', '/sources/:id', (ctx, req) => S.getSource(ctx, req.params.id));
  ws('PATCH', '/sources/:id', (ctx, req) => S.updateSource(ctx, req.params.id, z.object({ quality: z.string().optional(), title: z.string().max(300).optional(), publisher: z.string().max(200).optional(), candidateId: z.string().nullish(), aiEnabled: z.boolean().optional(), publishedAt: z.string().nullish() }).parse(req.body)));
  ws('DELETE', '/sources/:id', (ctx, req) => S.deleteSource(ctx, req.params.id));
  ws('POST', '/sources/:id/reprocess', (ctx, req) => S.reprocessSource(ctx, req.params.id));

  // facts
  ws('GET', '/projects/:pid/facts', (ctx, req) => F.listFacts(ctx, req.params.pid, req.query));
  ws('POST', '/projects/:pid/facts', (ctx, req) => F.addManualFact(ctx, req.params.pid, F.ManualFactInput.parse(req.body)));
  ws('POST', '/projects/:pid/facts/bulk-review', (ctx, req) => {
    const b = z.object({ factIds: z.array(z.string()).max(500), action: z.enum(['confirm', 'reject']) }).parse(req.body);
    return F.bulkReview(ctx, req.params.pid, b.factIds, b.action);
  });
  ws('POST', '/projects/:pid/conflicts/resolve', (ctx, req) => F.resolveConflict(ctx, req.params.pid, z.object({ keepFactId: z.string(), supersedeFactIds: z.array(z.string()).min(1).max(50), note: z.string().max(2000).nullish() }).parse(req.body)));
  ws('GET', '/facts/:id/evidence', (ctx, req) => F.getEvidence(ctx, req.params.id));
  ws('POST', '/facts/:id/review', (ctx, req) => F.reviewFact(ctx, req.params.id, F.ReviewInput.parse(req.body)));
  ws('PATCH', '/facts/:id', (ctx, req) => F.patchFact(ctx, req.params.id, F.FactPatch.parse(req.body)));

  // attributes & normalization
  ws('GET', '/projects/:pid/attributes', (ctx, req) => P.listAttributes(ctx, req.params.pid));
  ws('POST', '/projects/:pid/attributes', (ctx, req) => P.createAttribute(ctx, req.params.pid, req.body));
  ws('PATCH', '/attributes/:id', (ctx, req) => P.updateAttribute(ctx, req.params.id, P.AttributeInput.partial().parse(req.body)));
  ws('GET', '/projects/:pid/attributes/suggestions', (ctx, req) => P.attributeSuggestions(ctx, req.params.pid));
  ws('POST', '/projects/:pid/attributes/map-label', (ctx, req) => {
    const b = z.object({ label: z.string().max(200), attributeKey: z.string().max(48) }).parse(req.body);
    return P.mapLabel(ctx, req.params.pid, b.label, b.attributeKey);
  });
  ws('GET', '/projects/:pid/rules', (ctx, req) => P.listRules(ctx, req.params.pid));

  // prices
  ws('GET', '/projects/:pid/prices', (ctx, req) => F.listPrices(ctx, req.params.pid));
  ws('POST', '/projects/:pid/prices', (ctx, req) => F.addPrice(ctx, req.params.pid, req.body));
  ws('PATCH', '/prices/:id/fx', (ctx, req) =>
    F.updatePriceFx(ctx, req.params.id, z.object({ fxRate: z.number().positive(), fxBase: z.string().regex(/^[A-Z]{3}$/), fxSource: z.string().min(1).max(200), fxAt: z.string().datetime({ offset: true }) }).parse(req.body)),
  );

  // criteria & scenarios
  ws('GET', '/projects/:pid/criteria', (ctx, req) => P.listCriteria(ctx, req.params.pid));
  ws('POST', '/projects/:pid/criteria', (ctx, req) => P.createCriterion(ctx, req.params.pid, req.body));
  ws('POST', '/projects/:pid/criteria/suggest', (ctx, req) => P.suggestCriteria(ctx, req.params.pid));
  ws('PATCH', '/criteria/:id', (ctx, req) => P.updateCriterion(ctx, req.params.id, req.body));
  ws('DELETE', '/criteria/:id', (ctx, req) => P.deleteCriterion(ctx, req.params.id));
  ws('PUT', '/projects/:pid/weights', (ctx, req) => P.setWeights(ctx, req.params.pid, z.record(z.string(), z.number()).parse(req.body)));
  ws('GET', '/projects/:pid/scenarios', (ctx, req) => P.listScenarios(ctx, req.params.pid));
  ws('POST', '/projects/:pid/scenarios', (ctx, req) => P.createScenario(ctx, req.params.pid, req.body));
  ws('PATCH', '/scenarios/:id', (ctx, req) => P.updateScenario(ctx, req.params.id, req.body));
  ws('DELETE', '/scenarios/:id', (ctx, req) => P.deleteScenario(ctx, req.params.id));

  // comparison
  ws('GET', '/projects/:pid/compare', (ctx, req) =>
    C.getCompare(ctx, req.params.pid, { scenarioId: req.query.scenarioId || null, factPolicy: req.query.factPolicy === 'include_unreviewed' ? 'include_unreviewed' : req.query.factPolicy === 'confirmed_only' ? 'confirmed_only' : undefined }),
  );
  ws('GET', '/projects/:pid/scenario-matrix', (ctx, req) => C.getScenarioMatrix(ctx, req.params.pid));
  ws('GET', '/projects/:pid/missing', (ctx, req) => C.getMissing(ctx, req.params.pid));
  ws('GET', '/projects/:pid/compare.csv', async (ctx, req, reply) => {
    const csv = await C.compareCsv(ctx, req.params.pid);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="selequo-compare.csv"');
    return reply.send(csv);
  });

  // questions, assistant, notes, comments
  ws('GET', '/projects/:pid/questions', (ctx, req) => P.listQuestions(ctx, req.params.pid));
  ws('POST', '/projects/:pid/questions', (ctx, req) => P.createQuestion(ctx, req.params.pid, P.QuestionInput.parse(req.body)));
  ws('PATCH', '/questions/:id', (ctx, req) => P.updateQuestion(ctx, req.params.id, P.AnswerInput.parse(req.body)));
  ws('POST', '/projects/:pid/assistant', (ctx, req) => Q.ask(ctx, req.params.pid, Q.AskInput.parse(req.body)), importLimit);
  ws('GET', '/projects/:pid/notes', (ctx, req) => P.listNotes(ctx, req.params.pid));
  ws('POST', '/projects/:pid/notes', (ctx, req) => P.createNote(ctx, req.params.pid, z.object({ id: z.string().optional(), candidateId: z.string().nullish(), body: z.string() }).parse(req.body)));
  ws('GET', '/projects/:pid/comments', (ctx, req) => P.listComments(ctx, req.params.pid, req.query.entityType, req.query.entityId));
  ws('POST', '/projects/:pid/comments', (ctx, req) => P.createComment(ctx, req.params.pid, z.object({ entityType: z.string(), entityId: z.string(), body: z.string() }).parse(req.body)));

  // decision & brief
  ws('GET', '/projects/:pid/decision', (ctx, req) => D.getDecision(ctx, req.params.pid));
  ws('PUT', '/projects/:pid/decision', (ctx, req) => D.saveDecision(ctx, req.params.pid, req.body));
  ws('POST', '/projects/:pid/decision/review', (ctx, req) => D.reviewDecision(ctx, req.params.pid, D.ReviewDecisionInput.parse(req.body)));
  ws('GET', '/projects/:pid/brief/preview', (ctx, req) => D.buildProjectBrief(ctx, req.params.pid));
  ws('GET', '/projects/:pid/briefs', (ctx, req) => D.listBriefs(ctx, req.params.pid));
  ws('POST', '/projects/:pid/briefs', (ctx, req) => D.createBriefVersion(ctx, req.params.pid));
  ws('GET', '/briefs/:id', (ctx, req) => D.getBrief(ctx, req.params.id));
  ws('PATCH', '/briefs/:id', (ctx, req) => D.setBriefReview(ctx, req.params.id, z.object({ reviewState: z.enum(['draft', 'in_review', 'approved']) }).parse(req.body).reviewState));
  ws('GET', '/projects/:pid/brief/export', async (ctx, req, reply) => {
    const format = z.enum(['md', 'html', 'txt', 'json', 'pdf']).parse(req.query.format ?? 'md');
    const content = req.query.briefId ? (await D.getBrief(ctx, req.query.briefId)).content : await D.buildProjectBrief(ctx, req.params.pid);
    const out = await D.exportBrief(ctx, content, format, req.params.pid);
    reply.header('content-type', out.mime).header('content-disposition', `attachment; filename="decision-brief.${out.ext}"`);
    if (format === 'html') reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    return reply.send(typeof out.body === 'string' ? out.body : Buffer.from(out.body));
  });

  // sharing
  ws('GET', '/projects/:pid/shares', (ctx, req) => SH.listShareLinks(ctx, req.params.pid));
  ws('POST', '/projects/:pid/shares', (ctx, req) => SH.createShareLink(ctx, req.params.pid, z.object({ days: z.number().int().optional() }).parse(req.body ?? {}).days));
  ws('DELETE', '/shares/:id', (ctx, req) => SH.revokeShareLink(ctx, req.params.id));

  // ---------- MCP (Streamable HTTP, bearer API token)
  await registerMcp(app, { db, deps });

  // ---------- static web app (production build)
  const webDir = path.resolve(process.cwd(), 'dist/web');
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/', wildcard: false, setHeaders: (res: any, p: string) => { if (p.endsWith('sw.js')) res.setHeader('cache-control', 'no-cache'); } });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/mcp')) return reply.status(404).send({ error: 'not_found', message: 'Not found' });
      return reply.type('text/html').sendFile('index.html');
    });
  }

  return { app, deps, runner, systemCtx };
}
