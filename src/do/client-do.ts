import { DurableObject } from 'cloudflare:workers';

export type OAuthClient = {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  createdAt: string;
};

export class ClientDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    return (await this.ctx.storage.get<OAuthClient>(clientId)) ?? null;
  }

  async createClient(client: OAuthClient): Promise<void> {
    await this.ctx.storage.put(client.client_id, client);
  }

  async verifyClient(clientId: string, clientSecret: string): Promise<boolean> {
    const client = await this.getClient(clientId);
    return client !== null && client.client_secret === clientSecret;
  }

  async verifyRedirectUri(clientId: string, redirectUri: string): Promise<boolean> {
    const client = await this.getClient(clientId);
    return client !== null && client.redirect_uris.includes(redirectUri);
  }
}
