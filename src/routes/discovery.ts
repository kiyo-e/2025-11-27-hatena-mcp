import { Hono } from 'hono';
import type { Env } from '../types';

export const app = new Hono<{ Bindings: Env }>();

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
