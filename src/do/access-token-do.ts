import { DurableObject } from 'cloudflare:workers';

export type AccessToken = {
  token: string;
  userId: string;
  clientId: string;
  scope: string;
  expiresAt: number;
  createdAt: string;
};

export class AccessTokenDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  async storeToken(accessToken: AccessToken): Promise<void> {
    const ttl = Math.max(0, Math.floor((accessToken.expiresAt - Date.now()) / 1000));
    await this.ctx.storage.put(accessToken.token, accessToken, { expirationTtl: ttl });
  }

  async getToken(token: string): Promise<AccessToken | null> {
    const accessToken = await this.ctx.storage.get<AccessToken>(token);
    if (!accessToken) return null;

    // Verify not expired
    if (Date.now() > accessToken.expiresAt) {
      await this.ctx.storage.delete(token);
      return null;
    }

    return accessToken;
  }

  async revokeToken(token: string): Promise<void> {
    await this.ctx.storage.delete(token);
  }
}
