import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Env } from '../types';
import { clearUserHatena, getUserState, saveUserBlog, storeOAuthState } from '../lib/state';
import { buildAuthorizeUrl, createEntry, getRequestToken, listEntries, updateEntry } from '../lib/hatena';
import * as z from 'zod';

function ensureHatenaSession(state: Awaited<ReturnType<typeof getUserState>>) {
  if (!state?.hatena || !state.hatena.hatenaId) {
    throw new Error('Hatena account not linked');
  }
  return state.hatena as Required<NonNullable<typeof state>['hatena']>;
}

export function buildMcpServer(env: Env, userId: string, requestUrl: string) {
  const server = new McpServer(
    { name: 'hatena-blog-mcp', version: '1.0.0' },
    { jsonSchemaValidator: undefined }
  );

  server.registerTool(
    'start_hatena_oauth',
    {
      title: 'Begin Hatena OAuth flow',
      description: 'Returns the authorization URL to link Hatena Blog.',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        authorizeUrl: z.string().url(),
        state: z.string(),
      }),
    },
    async () => {
      try {
        const state = crypto.randomUUID();
        const callbackUrl = new URL('/hatena/oauth/callback', requestUrl).toString();
        const { requestToken, requestTokenSecret } = await getRequestToken(env, callbackUrl);
        const record = {
          userId,
          requestToken,
          requestTokenSecret,
          createdAt: new Date().toISOString(),
        };
        // Store by state and by requestToken (Hatena may not echo state back)
        await storeOAuthState(env, state, record);
        await storeOAuthState(env, requestToken, record);
        const authorizeUrl = buildAuthorizeUrl(requestToken, state);
        const payload = { authorizeUrl, state };
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          structuredContent: payload,
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'start_hatena_oauth failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'list_entries',
    {
      title: 'List Hatena blog entries',
      description: 'Fetches entries for a blog ID.',
      inputSchema: z.object({
        blogId: z.string(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }),
    },
    async (args) => {
      try {
        const hatena = ensureHatenaSession(await getUserState(env, userId));
        const data = await listEntries(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          args.blogId,
          { limit: args.limit, offset: args.offset },
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'list_entries failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'create_entry',
    {
      title: 'Create Hatena blog entry',
      description: 'Creates a new entry.',
      inputSchema: z.object({
        blogId: z.string(),
        title: z.string(),
        content: z.string(),
        draft: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        const hatena = ensureHatenaSession(await getUserState(env, userId));
        const result = await createEntry(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          args.blogId,
          { title: args.title, content: args.content, draft: args.draft },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'create_entry failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'update_entry',
    {
      title: 'Update Hatena blog entry',
      description: 'Updates an existing entry.',
      inputSchema: z.object({
        blogId: z.string(),
        entryId: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        draft: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        const hatena = ensureHatenaSession(await getUserState(env, userId));
        const result = await updateEntry(
          env,
          { accessToken: hatena.accessToken, accessSecret: hatena.accessSecret, hatenaId: hatena.hatenaId },
          args.blogId,
          args.entryId,
          { title: args.title, content: args.content, draft: args.draft },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'update_entry failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'save_blog',
    {
      title: 'Save Hatena blog metadata',
      description: 'Stores a blogId (and optional title/url) for later reuse.',
      inputSchema: z.object({
        blogId: z.string(),
        title: z.string().optional(),
        url: z.string().url().optional(),
      }),
    },
    async (args) => {
      try {
        ensureHatenaSession(await getUserState(env, userId));
        const state = await saveUserBlog(env, userId, { blogId: args.blogId, title: args.title, url: args.url });
        const blogs = state.hatena?.blogs ?? [];
        return { content: [{ type: 'text', text: JSON.stringify({ saved: args.blogId, blogs }) }], structuredContent: { saved: args.blogId, blogs } };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'save_blog failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'list_saved_blogs',
    {
      title: 'List saved Hatena blogs',
      description: 'Returns blogId/title/url saved in the user state.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      try {
        const state = ensureHatenaSession(await getUserState(env, userId));
        const blogs = state.blogs ?? [];
        return { content: [{ type: 'text', text: JSON.stringify({ blogs }) }], structuredContent: { blogs } };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'list_saved_blogs failed' }], isError: true };
      }
    }
  );

  server.registerTool(
    'reset_hatena_session',
    {
      title: 'Clear stored Hatena tokens',
      description: 'Deletes the linked Hatena account from durable storage so you can re-authenticate cleanly.',
      inputSchema: z.object({}).strict(),
    },
    async () => {
      try {
        await clearUserHatena(env, userId);
        return { content: [{ type: 'text', text: 'Hatena session cleared. Run start_hatena_oauth again.' }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: e?.message ?? 'reset_hatena_session failed' }], isError: true };
      }
    }
  );

  return server;
}

export async function handleMcpRequest(server: McpServer, transport: Transport, c: any) {
  await server.connect(transport as unknown as Transport);
  return (transport as any).handleRequest(c);
}
