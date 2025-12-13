import { jwtVerify, JWTPayload, importJWK } from 'jose';
import { Env } from '../types';

export type AuthContext = { userId: string; token: JWTPayload };

function unauthorized(request: Request, description: string, resourceMetadataPath = '/.well-known/oauth-protected-resource/mcp') {
  const origin = new URL(request.url).origin;
  const normalizedPath = resourceMetadataPath.startsWith('/')
    ? resourceMetadataPath
    : `/${resourceMetadataPath}`;
  const resourceMetadata = `${origin}${normalizedPath}`;
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
  opts?: { resource?: string | string[]; resourceMetadataPath?: string }
): Promise<AuthContext> {
  const resourceMetadataPath = opts?.resourceMetadataPath;
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw unauthorized(request, 'Missing bearer token', resourceMetadataPath);
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
  const resources = opts?.resource
    ? Array.isArray(opts.resource)
      ? opts.resource
      : [opts.resource]
    : [];
  const audience = resources.length > 0 ? [...resources, issuer] : [issuer];
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, publicKey, {
      issuer,
      audience,
    }));
  } catch (_err) {
    throw unauthorized(request, 'Invalid or expired token', resourceMetadataPath);
  }

  const sub = payload.sub;
  if (!sub) throw unauthorized(request, 'Invalid token: no sub', resourceMetadataPath);

  return { userId: sub, token: payload };
}
