import { SignJWT, importJWK, exportJWK } from 'jose';

export type JWKPair = {
  publicJwk: any;
  privateJwk: any;
};

// Generate RS256 key pair for JWT signing
export async function generateKeyPair(): Promise<JWKPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey!);

  // Add required JWK fields
  publicJwk.kid = crypto.randomUUID();
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  privateJwk.kid = publicJwk.kid;
  privateJwk.alg = 'RS256';
  privateJwk.use = 'sig';

  return { publicJwk, privateJwk };
}

export async function signAccessToken(
  payload: { userId: string; clientId: string; scope: string },
  privateJwk: any,
  issuer: string,
  audience: string | string[],
  expiresIn: number = 3600
): Promise<string> {
  const privateKey = await importJWK(privateJwk, 'RS256');

  const jwt = await new SignJWT({
    sub: payload.userId,
    client_id: payload.clientId,
    scope: payload.scope,
  })
    .setProtectedHeader({ alg: 'RS256', kid: privateJwk.kid })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(`${expiresIn}s`)
    .sign(privateKey);

  return jwt;
}

export function buildJWKS(publicJwk: any) {
  return {
    keys: [publicJwk],
  };
}
