import { Hono } from 'hono';
import { Env } from './types';
import { app as discoveryRoutes } from './routes/discovery';
import { app as oauthRoutes } from './routes/oauth';
import { app as hatenaCallbackRoute } from './routes/hatena-callback';
import { app as mcpRoutes } from './routes/mcp';
import { UserDurableObject } from './do/user-do';
import { OAuthStateDurableObject } from './do/oauth-state-do';
import { ClientDurableObject } from './do/client-do';
import { AuthCodeDurableObject } from './do/auth-code-do';
import { AccessTokenDurableObject } from './do/access-token-do';

const app = new Hono<{ Bindings: Env }>();

// Mount sub-apps to keep main entry lean
app.route('/', discoveryRoutes);
app.route('/', oauthRoutes);
app.route('/', hatenaCallbackRoute);
app.route('/', mcpRoutes);

export default app;
export {
  UserDurableObject,
  OAuthStateDurableObject,
  ClientDurableObject,
  AuthCodeDurableObject,
  AccessTokenDurableObject,
};
