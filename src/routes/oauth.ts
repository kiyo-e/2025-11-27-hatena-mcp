import { Hono } from 'hono';
import { signAccessToken, buildJWKS } from '../lib/jwt';
import { sha256base64url } from '../lib/crypto';
import type { CloudflareBindings } from '../types';

export const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get('/oauth/jwks', (c) => {
  const publicKeyJson = c.env.JWT_PUBLIC_KEY;
  if (!publicKeyJson) {
    return c.json({ error: 'JWT public key not configured' }, 500);
  }
  const publicJwk = JSON.parse(publicKeyJson);
  return c.json(buildJWKS(publicJwk));
});

app.get('/oauth/authorize', async (c) => {
  const url = new URL(c.req.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  const scope = url.searchParams.get('scope') || '';
  const responseType = url.searchParams.get('response_type');
  const resource = url.searchParams.get('resource') || undefined;
  const codeChallenge = url.searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod = (url.searchParams.get('code_challenge_method') as 'S256' | 'plain' | null) || undefined;

  if (!clientId || !redirectUri || responseType !== 'code') {
    return c.text('Invalid authorization request', 400);
  }

  const clientStub = c.env.CLIENT_DO.get(c.env.CLIENT_DO.idFromName('clients'));
  const client = await clientStub.getClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return c.text('Invalid client or redirect_uri', 400);
  }

  const userId = crypto.randomUUID();
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
    expiresAt: Date.now() + 600000,
    createdAt: new Date().toISOString(),
  });

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return c.redirect(redirectUrl.toString());
});

app.post('/oauth/setup', async (c) => {
  const setupSecret = c.env.SETUP_SECRET;
  if (!setupSecret) {
    return c.json({ error: 'server_not_configured' }, 500);
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (token !== setupSecret) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = (await c.req.json()) as any;
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

app.post('/oauth/token', async (c) => {
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

  const clientStub = c.env.CLIENT_DO.get(c.env.CLIENT_DO.idFromName('clients'));
  const isValid = await clientStub.verifyClient(clientId, clientSecret);
  if (!isValid) {
    return c.json({ error: 'invalid_client' }, 401);
  }

  const authCodeStub = c.env.AUTH_CODE_DO.get(c.env.AUTH_CODE_DO.idFromName(code));
  const authCode = await authCodeStub.consumeCode(code);
  if (!authCode) {
    return c.json({ error: 'invalid_grant' }, 400);
  }

  if (authCode.redirectUri !== redirectUri || authCode.clientId !== clientId) {
    return c.json({ error: 'invalid_grant' }, 400);
  }

  const resolvedResource = authCode.resource ?? resource;
  if (resource && authCode.resource && resource !== authCode.resource) {
    return c.json({ error: 'invalid_target', error_description: 'resource mismatch' }, 400);
  }

  if (authCode.codeChallenge) {
    if (!codeVerifier) {
      return c.json({ error: 'invalid_grant', error_description: 'code_verifier required' }, 400);
    }
    const method = authCode.codeChallengeMethod || 'plain';
    const derived = method === 'S256' ? await sha256base64url(codeVerifier) : codeVerifier;
    if (derived !== authCode.codeChallenge) {
      return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }
  }

  const privateKeyJson = c.env.JWT_PRIVATE_KEY;
  if (!privateKeyJson) {
    return c.json({ error: 'server_error' }, 500);
  }

  const privateJwk = JSON.parse(privateKeyJson);
  const issuer = new URL(c.req.url).origin;
  const audience = resolvedResource ?? issuer;
  const expiresIn = 3600;

  const accessToken = await signAccessToken(
    {
      userId: authCode.userId,
      clientId: authCode.clientId,
      scope: authCode.scope,
    },
    privateJwk,
    issuer,
    audience,
    expiresIn,
  );

  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
  });
});
