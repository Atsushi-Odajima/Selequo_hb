// MCP server over Streamable HTTP (stateless) at /mcp. Auth: `Authorization: Bearer <API token>`.
// A token is bound to one workspace and its permissions never exceed the owner's current role.

import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Db } from '../server/db';
import { resolveApiToken } from '../server/services/accounts';
import { HttpError, type Ctx, type Deps } from '../server/services/core';
import { TOOLS } from './tools';

export function buildMcpServer(ctx: Ctx) {
  const server = new McpServer({ name: 'selequo', version: ctx.config.appVersion }, { instructions: 'Selequo comparison tools. Facts carry citations; Unknown is not zero; tools never choose a candidate for the user.' });
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: !t.write, destructiveHint: false, openWorldHint: t.name === 'add_source' } },
      async (args: Record<string, unknown>) => {
        try {
          if (t.write && !ctx.scopes.includes('write')) throw new HttpError(403, 'forbidden', 'このトークンには書き込み権限（write scope）がありません');
          const result = await t.run(ctx, args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { isError: true, content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] };
        }
      },
    );
  }
  return server;
}

export async function registerMcp(app: FastifyInstance, opts: { db: Db; deps: Deps }) {
  const handle = async (req: any, reply: any) => {
    const h = req.headers.authorization as string | undefined;
    const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
    const t = token ? await resolveApiToken(opts.db, token) : null;
    if (!t) {
      reply.header('www-authenticate', 'Bearer realm="selequo"');
      return reply.status(401).send({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: API token required' }, id: null });
    }
    if (req.method !== 'POST') return reply.status(405).header('allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null });
    const ctx: Ctx = { ...opts.deps, workspaceId: t.workspaceId, role: t.role, scopes: t.scopes, actor: { type: 'token', userId: t.userId, tokenId: t.tokenId, name: `${t.userName}（MCP）` } };
    const server = buildMcpServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };
  app.route({ method: ['GET', 'POST', 'DELETE'], url: '/mcp', config: { rateLimit: { max: 300, timeWindow: '1 minute' } }, handler: handle });
}
