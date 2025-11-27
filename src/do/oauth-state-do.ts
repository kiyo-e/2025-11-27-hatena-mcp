import { DurableObject } from 'cloudflare:workers';
import { OAuthState } from '../types';

export class OAuthStateDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  async getState(key: string): Promise<OAuthState | null> {
    return (await this.ctx.storage.get<OAuthState>(key)) ?? null;
  }

  async putState(key: string, value: OAuthState): Promise<void> {
    await this.ctx.storage.put(key, value, { expirationTtl: 600 });
  }

  async takeState(key: string): Promise<OAuthState | null> {
    const val = await this.ctx.storage.get<OAuthState>(key);
    if (val) await this.ctx.storage.delete(key);
    return val ?? null;
  }

  async deleteState(key: string): Promise<void> {
    await this.ctx.storage.delete(key);
  }
}
