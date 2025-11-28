export type BlogInfo = {
  blogId: string;
  title?: string;
  url?: string;
};

export type UserState = {
  hatena?: {
    accessToken: string;
    accessSecret: string;
    hatenaId?: string;
    blogs?: BlogInfo[];
  };
  createdAt: string;
  updatedAt: string;
};

export type OAuthState = {
  userId: string;
  requestToken: string;
  requestTokenSecret: string;
  createdAt: string;
};

export interface Env {
  USER_DO: DurableObjectNamespace;
  OAUTH_STATE_DO: DurableObjectNamespace;
  CLIENT_DO: DurableObjectNamespace;
  AUTH_CODE_DO: DurableObjectNamespace;
  ACCESS_TOKEN_DO: DurableObjectNamespace;
  HATENA_CONSUMER_KEY: string;
  HATENA_CONSUMER_SECRET: string;
  OAUTH_ISSUER: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  OAUTH_REDIRECT_URIS: string;
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY: string;
  SETUP_SECRET: string;
}

// Alias to align with Hono/Cloudflare naming convention
export type CloudflareBindings = Env;
