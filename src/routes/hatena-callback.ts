import { Hono } from 'hono';
import { consumeOAuthState, deleteOAuthState, updateUserHatena } from '../lib/state';
import { exchangeAccessToken } from '../lib/hatena';
import type { Env } from '../types';

export const app = new Hono<{ Bindings: Env }>();

app.get('/hatena/oauth/callback', async (c) => {
  const url = new URL(c.req.url);
  const stateParam = url.searchParams.get('state');
  const oauthToken = url.searchParams.get('oauth_token');
  const verifier = url.searchParams.get('oauth_verifier');
  if (!oauthToken || !verifier) return c.text('Missing oauth params', 400);

  let stored = stateParam ? await consumeOAuthState(c.env, stateParam) : null;
  if (!stored) {
    stored = await consumeOAuthState(c.env, oauthToken);
  }
  if (!stored || stored.requestToken !== oauthToken) return c.text('Invalid or expired state', 400);
  if (stateParam && stateParam !== oauthToken) {
    await deleteOAuthState(c.env, oauthToken).catch(() => {});
  }

  try {
    const { accessToken, accessSecret, hatenaId } = await exchangeAccessToken(
      c.env,
      stored.requestToken,
      stored.requestTokenSecret,
      verifier,
    );
    await updateUserHatena(c.env, stored.userId, {
      accessToken,
      accessSecret,
      hatenaId: hatenaId ?? undefined,
    });
    return c.html(
      '<html><body>\n      <h2>Hatena blog connected</h2>\n      <p>You can close this tab and return to ChatGPT.</p>\n      </body></html>'
    );
  } catch (e: any) {
    console.error(e);
    return c.text('Failed to complete authorization', 500);
  }
});
