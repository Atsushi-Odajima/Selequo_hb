// stdio ↔ Streamable HTTP bridge so local MCP clients (Claude Desktop/Code, Codex, etc.) can use a
// Selequo server. Usage: SELEQUO_URL=https://... SELEQUO_TOKEN=slq_... npx tsx src/mcp/stdio.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const base = process.env.SELEQUO_URL ?? 'http://localhost:8787';
const token = process.env.SELEQUO_TOKEN;
if (!token) {
  console.error('SELEQUO_TOKEN is required (create one in Settings → API tokens)');
  process.exit(1);
}

const client = new Client({ name: 'selequo-stdio-bridge', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));

const server = new Server({ name: 'selequo', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => client.listTools());
server.setRequestHandler(CallToolRequestSchema, async (req) => client.callTool(req.params) as never);
await server.connect(new StdioServerTransport());
