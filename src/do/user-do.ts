import { DurableObject } from 'cloudflare:workers';
import { UserState, Env } from '../types';

export class UserDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async getState(): Promise<UserState | null> {
    const stored = await this.ctx.storage.get<UserState>('state');
    return stored ?? null;
  }

  async updateHatena(data: NonNullable<UserState['hatena']>): Promise<UserState> {
    const now = new Date().toISOString();
    const current = (await this.getState()) ?? { createdAt: now, updatedAt: now };
    const next: UserState = { ...current, hatena: data, updatedAt: now };
    await this.ctx.storage.put('state', next);
    return next;
  }
}
