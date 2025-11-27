import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import type { CloudflareBindings } from '../types';
import { verifyBearerToken } from '../lib/auth';
import { buildMcpServer, handleMcpRequest } from '../mcp/server';

export const app = new Hono<{ Bindings: CloudflareBindings }>();

app.all('/mcp', async (c) => {
  try {
    const resource = `${new URL(c.req.url).origin}/mcp`;
    const auth = await verifyBearerToken(c.req.raw, c.env, { resource });

    const server = buildMcpServer(c.env, auth.userId, c.req.url);
    const transport = new StreamableHTTPTransport();

    return await handleMcpRequest(server, transport as any, c);
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error(err);
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err?.message ?? 'Server error' } }, 500);
  }
});

app.get('/mcp', (c) => {
  return c.json({ status: 'ok', message: 'Use POST with Bearer auth for JSON-RPC' });
});

app.options('/mcp', (c) => {
  c.header('Allow', 'GET, POST, OPTIONS');
  return c.text('ok');
});
