import { DurableObject } from 'cloudflare:workers';

export type AuthCode = {
  code: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
  expiresAt: number;
  createdAt: string;
};

export class AuthCodeDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  async storeCode(authCode: AuthCode): Promise<void> {
    const ttl = Math.max(0, Math.floor((authCode.expiresAt - Date.now()) / 1000));
    await this.ctx.storage.put(authCode.code, authCode, { expirationTtl: ttl });
  }

  async consumeCode(code: string): Promise<AuthCode | null> {
    const authCode = await this.ctx.storage.get<AuthCode>(code);
    if (!authCode) return null;

    // Verify not expired
    if (Date.now() > authCode.expiresAt) {
      await this.ctx.storage.delete(code);
      return null;
    }

    // One-time use: delete immediately after retrieval
    await this.ctx.storage.delete(code);
    return authCode;
  }
}
