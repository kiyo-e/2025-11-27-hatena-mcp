import { jwtVerify, JWTPayload, importJWK } from 'jose';
import { Env } from '../types';

export type AuthContext = { userId: string; token: JWTPayload };

export async function verifyBearerToken(
  request: Request,
  env: Env,
  opts?: { resource?: string }
): Promise<AuthContext> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw new Response('Missing bearer token', { status: 401 });
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
  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
    audience,
  });

  const sub = payload.sub;
  if (!sub) throw new Response('Invalid token: no sub', { status: 401 });

  return { userId: sub, token: payload };
}
