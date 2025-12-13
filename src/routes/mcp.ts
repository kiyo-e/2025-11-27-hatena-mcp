import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import type { CloudflareBindings } from '../types';
import { verifyBearerToken } from '../lib/auth';
import { buildMcpServer, handleMcpRequest } from '../mcp/server';

export const app = new Hono<{ Bindings: CloudflareBindings }>();

app.all('/mcp', async (c) => {
  const unauthorizedWithMetadata = () => {
    const origin = new URL(c.req.url).origin;
    const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadata}"` },
    });
  };

  const authz = c.req.header('authorization');
  if (!authz) return unauthorizedWithMetadata();

  try {
    const origin = new URL(c.req.url).origin;
    const resource = `${origin}/mcp`;
    const auth = await verifyBearerToken(c.req.raw, c.env, {
      resource: [resource, origin],
      resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
    });

    const server = buildMcpServer(c.env, auth.userId, c.req.url);
    const transport = new StreamableHTTPTransport();

    return await handleMcpRequest(server, transport as any, c);
  } catch (err: any) {
    if (err instanceof Response) {
      if (err.status === 401 && !err.headers.get('WWW-Authenticate')) {
        return unauthorizedWithMetadata();
      }
      return err;
    }
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
