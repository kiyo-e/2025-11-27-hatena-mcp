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
    // Preserve existing blogs unless caller explicitly supplies them.
    const mergedHatena = {
      ...(current.hatena ?? {}),
      ...data,
      blogs: data.blogs ?? current.hatena?.blogs,
    };
    const next: UserState = { ...current, hatena: mergedHatena, updatedAt: now };
    await this.ctx.storage.put('state', next);
    return next;
  }

  async saveBlog(info: { blogId: string; title?: string; url?: string }): Promise<UserState> {
    const now = new Date().toISOString();
    const current = (await this.getState()) ?? { createdAt: now, updatedAt: now };
    if (!current.hatena) throw new Error('Hatena account not linked');
    const existing = current.hatena.blogs ?? [];
    const idx = existing.findIndex((b) => b.blogId === info.blogId);
    const nextBlogs = idx >= 0
      ? existing.map((b, i) => (i === idx ? { ...b, ...info } : b))
      : [...existing, info];
    const next: UserState = {
      ...current,
      hatena: { ...current.hatena, blogs: nextBlogs },
      updatedAt: now,
    };
    await this.ctx.storage.put('state', next);
    return next;
  }

  async clearHatena(): Promise<UserState> {
    const now = new Date().toISOString();
    const current = (await this.getState()) ?? { createdAt: now, updatedAt: now };
    const next: UserState = { ...current, hatena: undefined, updatedAt: now };
    await this.ctx.storage.put('state', next);
    return next;
  }
}
