import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Env } from '../types';
import { getUserState, storeOAuthState } from '../lib/state';
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

  return server;
}

export async function handleMcpRequest(server: McpServer, transport: Transport, c: any) {
  await server.connect(transport as unknown as Transport);
  return (transport as any).handleRequest(c);
}
