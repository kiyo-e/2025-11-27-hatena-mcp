import { Hono } from 'hono';
import { Env, UserState } from './types';
import { verifyBearerToken } from './lib/auth';
import {
  buildAuthorizeUrl,
  createEntry,
  exchangeAccessToken,
  getRequestToken,
  listEntries,
  updateEntry,
} from './lib/hatena';
import { UserDurableObject } from './do/user-do';
import { OAuthStateDurableObject } from './do/oauth-state-do';
import { ClientDurableObject } from './do/client-do';
import { AuthCodeDurableObject } from './do/auth-code-do';
import { AccessTokenDurableObject } from './do/access-token-do';
import { signAccessToken, buildJWKS } from './lib/jwt';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import * as z from 'zod';
// JSON-RPC-ish request/response
interface RpcRequest {
  id?: string | number | null;
  method: string;
  params?: any;
}

const app = new Hono<{ Bindings: Env }>();

// Well-known endpoints for MCP OAuth
app.get('/.well-known/oauth-protected-resource', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
  });
});

app.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    jwks_uri: `${baseUrl}/oauth/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
  });
});

// OAuth JWKS endpoint
app.get('/oauth/jwks', (c) => {
  const publicKeyJson = c.env.JWT_PUBLIC_KEY;
  if (!publicKeyJson) {
    return c.json({ error: 'JWT public key not configured' }, 500);
  }
  const publicJwk = JSON.parse(publicKeyJson);
  return c.json(buildJWKS(publicJwk));
});

// OAuth authorization endpoint
app.get('/oauth/authorize', async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  const scope = url.searchParams.get('scope') || '';
  const responseType = url.searchParams.get('response_type');
  const resource = url.searchParams.get('resource') || undefined;
  const codeChallenge = url.searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod =
    (url.searchParams.get('code_challenge_method') as 'S256' | 'plain' | null) || undefined;

  if (!clientId || !redirectUri || responseType !== 'code') {
    return c.text('Invalid authorization request', 400);
  }

  // Verify client
  const clientStub = c.env.CLIENT_DO.get(c.env.CLIENT_DO.idFromName('clients'));
  const client = await clientStub.getClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return c.text('Invalid client or redirect_uri', 400);
  }

  // For simplicity, auto-approve and generate userId
  // In production, you would show a consent screen here
  const userId = crypto.randomUUID();

  // Generate authorization code
  const code = crypto.randomUUID();
  const authCodeStub = c.env.AUTH_CODE_DO.get(c.env.AUTH_CODE_DO.idFromName(code));
  await authCodeStub.storeCode({
    code,
    userId,
    clientId,
    redirectUri,
    scope,
    resource,
    codeChallenge,
    codeChallengeMethod,
    expiresAt: Date.now() + 600000, // 10 minutes
    createdAt: new Date().toISOString(),
  });

  // Redirect back with code
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return c.redirect(redirectUrl.toString());
});

// OAuth client registration (one-time setup endpoint)
app.post('/oauth/setup', async (c) => {
  const body = await c.req.json() as any;
  const { client_id, client_secret, redirect_uris } = body;

  if (!client_id || !client_secret || !Array.isArray(redirect_uris)) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  const clientStub = c.env.CLIENT_DO.get(c.env.CLIENT_DO.idFromName('clients'));
  await clientStub.createClient({
    client_id,
    client_secret,
    redirect_uris,
    createdAt: new Date().toISOString(),
  });

  return c.json({ message: 'Client registered successfully' });
});

// OAuth token endpoint
app.post('/oauth/token', async (c) => {
  // Support both client_secret_post and client_secret_basic
  let basicAuthClientId: string | null = null;
  let basicAuthClientSecret: string | null = null;
  const authz = c.req.header('Authorization');
  if (authz?.startsWith('Basic ')) {
    try {
      const decoded = atob(authz.slice('Basic '.length));
      const [cid, ...rest] = decoded.split(':');
      basicAuthClientId = cid || null;
      basicAuthClientSecret = rest.join(':') || null;
    } catch (_err) {
      // Ignore malformed header; validation will fail below
    }
  }

  const body = await c.req.parseBody();
  const grantType = body['grant_type'];
  const code = body['code'] as string;
  const redirectUri = body['redirect_uri'] as string;
  const clientId = (body['client_id'] as string) ?? basicAuthClientId;
  const clientSecret = (body['client_secret'] as string) ?? basicAuthClientSecret;
  const codeVerifier = body['code_verifier'] as string | undefined;
  const resource = (body['resource'] as string | undefined) ?? undefined;

  if (grantType !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400);
  }

  if (!code || !redirectUri || !clientId || !clientSecret) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  // Verify client credentials
  const clientStub = c.env.CLIENT_DO.get(c.env.CLIENT_DO.idFromName('clients'));
  const isValid = await clientStub.verifyClient(clientId, clientSecret);
  if (!isValid) {
    return c.json({ error: 'invalid_client' }, 401);
  }

  // Consume authorization code
  const authCodeStub = c.env.AUTH_CODE_DO.get(c.env.AUTH_CODE_DO.idFromName(code));
  const authCode = await authCodeStub.consumeCode(code);
  if (!authCode) {
    return c.json({ error: 'invalid_grant' }, 400);
  }

  // Verify redirect_uri and client_id match
  if (authCode.redirectUri !== redirectUri || authCode.clientId !== clientId) {
    return c.json({ error: 'invalid_grant' }, 400);
  }

  // Resource indicator validation (if provided)
  const resolvedResource = authCode.resource ?? resource;
  if (resource && authCode.resource && resource !== authCode.resource) {
    return c.json({ error: 'invalid_target', error_description: 'resource mismatch' }, 400);
  }

  // PKCE verification when a code_challenge was supplied
  if (authCode.codeChallenge) {
    if (!codeVerifier) {
      return c.json({ error: 'invalid_grant', error_description: 'code_verifier required' }, 400);
    }
    const method = authCode.codeChallengeMethod || 'plain';
    const derived =
      method === 'S256'
        ? await sha256base64url(codeVerifier)
        : codeVerifier;
    if (derived !== authCode.codeChallenge) {
      return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }
  }

  // Generate JWT access token
  const privateKeyJson = c.env.JWT_PRIVATE_KEY;
  if (!privateKeyJson) {
    return c.json({ error: 'server_error' }, 500);
  }

  const privateJwk = JSON.parse(privateKeyJson);
  const issuer = new URL(c.req.url).origin;
  const audience = resolvedResource ?? issuer;
  const expiresIn = 3600; // 1 hour

  const accessToken = await signAccessToken(
    {
      userId: authCode.userId,
      clientId: authCode.clientId,
      scope: authCode.scope,
    },
    privateJwk,
    issuer,
    audience,
    expiresIn
  );

  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
  });
});

// Helper: load user state from DO
async function getUserState(env: Env, userId: string): Promise<UserState | null> {
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));
  return stub.getState();
}

async function putUserHatena(env: Env, userId: string, hatena: NonNullable<UserState['hatena']>) {
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));
  return stub.updateHatena(hatena);
}

async function putOAuthState(env: Env, state: string, value: any) {
  const stub = env.OAUTH_STATE_DO.get(env.OAUTH_STATE_DO.idFromName(state));
  await stub.putState(state, value);
}

async function takeOAuthState(env: Env, state: string) {
  const stub = env.OAUTH_STATE_DO.get(env.OAUTH_STATE_DO.idFromName(state));
  return stub.takeState(state);
}

async function deleteOAuthState(env: Env, key: string) {
  const stub = env.OAUTH_STATE_DO.get(env.OAUTH_STATE_DO.idFromName(key));
  await stub.deleteState(key);
}

function buildMcpServer(env: Env, userId: string, requestUrl: string) {
  const server = new McpServer(
    { name: 'hatena-blog-mcp', version: '1.0.0' },
    { jsonSchemaValidator: undefined }
  );

  server.registerTool(
    'start_hatena_oauth',
    {
      title: 'Begin Hatena OAuth flow',
      description: 'Returns the authorization URL to link Hatena Blog.',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        authorizeUrl: z.string().url(),
        state: z.string(),
      }),
    },
    async (_args, _extra) => {
      try {
        const state = crypto.randomUUID();
        const callbackUrl = new URL('/hatena/oauth/callback', requestUrl).toString();
        const { requestToken, requestTokenSecret } = await getRequestToken(env, callbackUrl);
        const record = {
          userId,
          requestToken,
          requestTokenSecret,
          createdAt: new Date().toISOString(),
        };
        // Store by state and by requestToken (Hatena may not echo state back)
        await putOAuthState(env, state, record);
        await putOAuthState(env, requestToken, record);
        const authorizeUrl = buildAuthorizeUrl(requestToken, state);
        const payload = { authorizeUrl, state };
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          structuredContent: payload,
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'start_hatena_oauth failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'list_entries',
    {
      title: 'List Hatena blog entries',
      description: 'Fetches entries for a blog ID.',
      inputSchema: z.object({
        blogId: z.string(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }),
    },
    async (args) => {
      try {
        const state = await getUserState(env, userId);
        const hatena = state?.hatena;
        if (!hatena || !hatena.hatenaId) {
          return { content: [{ type: 'text', text: 'Hatena account not linked' }], isError: true };
        }
        const data = await listEntries(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          args.blogId,
          { limit: args.limit, offset: args.offset },
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'list_entries failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'create_entry',
    {
      title: 'Create Hatena blog entry',
      description: 'Creates a new entry.',
      inputSchema: z.object({
        blogId: z.string(),
        title: z.string(),
        content: z.string(),
        draft: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        const state = await getUserState(env, userId);
        const hatena = state?.hatena;
        if (!hatena || !hatena.hatenaId) {
          return { content: [{ type: 'text', text: 'Hatena account not linked' }], isError: true };
        }
        const result = await createEntry(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          args.blogId,
          { title: args.title, content: args.content, draft: args.draft },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'create_entry failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'update_entry',
    {
      title: 'Update Hatena blog entry',
      description: 'Updates an existing entry.',
      inputSchema: z.object({
        blogId: z.string(),
        entryId: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        draft: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        const state = await getUserState(env, userId);
        const hatena = state?.hatena;
        if (!hatena || !hatena.hatenaId) {
          return { content: [{ type: 'text', text: 'Hatena account not linked' }], isError: true };
        }
        const result = await updateEntry(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          args.blogId,
          args.entryId,
          { title: args.title, content: args.content, draft: args.draft },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'update_entry failed' }], isError: true };
      }
    }
  );

  return server;
}

app.all('/mcp', async (c) => {
  try {
    const resource = `${new URL(c.req.url).origin}/mcp`;
    const auth = await verifyBearerToken(c.req.raw, c.env, { resource });

    const server = buildMcpServer(c.env, auth.userId, c.req.url);
    const transport = new StreamableHTTPTransport();

    await server.connect(transport as unknown as Transport);
    return transport.handleRequest(c);

  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error(err);
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err?.message ?? 'Server error' } }, 500);
  }
});

// Hatena callback (no Auth0)
app.get('/hatena/oauth/callback', async (c) => {
  const url = new URL(c.req.url);
  const stateParam = url.searchParams.get('state');
  const oauthToken = url.searchParams.get('oauth_token');
  const verifier = url.searchParams.get('oauth_verifier');
  if (!oauthToken || !verifier) return c.text('Missing oauth params', 400);

  // Prefer state lookup; if state is absent (Hatena may omit), fall back to oauth_token key.
  let stored = stateParam ? await takeOAuthState(c.env, stateParam) : null;
  if (!stored) {
    stored = await takeOAuthState(c.env, oauthToken);
  }
  if (!stored || stored.requestToken !== oauthToken) return c.text('Invalid or expired state', 400);
  // Clean up the alternate key as well
  if (stateParam && stateParam !== oauthToken) {
    await deleteOAuthState(c.env, oauthToken).catch(() => {});
  }

  try {
    const { accessToken, accessSecret, hatenaId } = await exchangeAccessToken(
      c.env,
      stored.requestToken,
      stored.requestTokenSecret,
      verifier,
    );
    await putUserHatena(c.env, stored.userId, {
      accessToken,
      accessSecret,
      hatenaId: hatenaId ?? undefined,
    });
    return c.html(`
      <html><body>
      <h2>Hatena blog connected</h2>
      <p>You can close this tab and return to ChatGPT.</p>
      </body></html>
    `);
  } catch (e: any) {
    console.error(e);
    return c.text('Failed to complete authorization', 500);
  }
});

// Health/handshake endpoint for connectors that probe with GET/OPTIONS
app.get('/mcp', (c) => {
  return c.json({ status: 'ok', message: 'Use POST with Bearer auth for JSON-RPC' });
});

app.options('/mcp', (c) => {
  c.header('Allow', 'GET, POST, OPTIONS');
  return c.text('ok');
});

// Some clients request well-known with resource suffix; support it.
app.get('/.well-known/oauth-protected-resource/:resource', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const { resource } = c.req.param();
  return c.json({
    resource: `${baseUrl}/${resource}`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
  });
});

async function sha256base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default app;
export {
  UserDurableObject,
  OAuthStateDurableObject,
  ClientDurableObject,
  AuthCodeDurableObject,
  AccessTokenDurableObject
};
