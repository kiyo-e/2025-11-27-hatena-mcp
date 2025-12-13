import { jwtVerify, JWTPayload, importJWK } from 'jose';
import { Env } from '../types';

export type AuthContext = { userId: string; token: JWTPayload };

function unauthorized(request: Request, env: Env, description: string) {
  const origin = new URL(request.url).origin;
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource`;
  const header =
    `Bearer resource_metadata="${resourceMetadata}", ` +
    `error="invalid_token", error_description="${description}"`;

  return new Response(description, {
    status: 401,
    headers: { 'WWW-Authenticate': header },
  });
}

export async function verifyBearerToken(
  request: Request,
  env: Env,
  opts?: { resource?: string }
): Promise<AuthContext> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw unauthorized(request, env, 'Missing bearer token');
  }
  const token = auth.slice('Bearer '.length);

  // Get public key from env
  const publicKeyJson = env.JWT_PUBLIC_KEY;
  if (!publicKeyJson) {
    throw new Response('JWT public key not configured', { status: 500 });
  }

  const publicJwk = JSON.parse(publicKeyJson);
  const publicKey = await importJWK(publicJwk, 'RS256');

  // Verify JWT
  const issuer = env.OAUTH_ISSUER;
  const audience = opts?.resource ? [opts.resource, issuer] : issuer;
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, publicKey, {
      issuer,
      audience,
    }));
  } catch (_err) {
    throw unauthorized(request, env, 'Invalid or expired token');
  }

  const sub = payload.sub;
  if (!sub) throw unauthorized(request, env, 'Invalid token: no sub');

  return { userId: sub, token: payload };
}
