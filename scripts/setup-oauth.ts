// Setup script to generate JWT keys and register OAuth client
// Run with: bun run scripts/setup-oauth.ts

import { generateKeyPair } from '../src/lib/jwt';

async function main() {
  console.log('Generating JWT key pair...');
  const { publicJwk, privateJwk } = await generateKeyPair();

  console.log('\n=== Add these to your .dev.vars file ===\n');

  console.log('JWT_PUBLIC_KEY=' + JSON.stringify(publicJwk));
  console.log('JWT_PRIVATE_KEY=' + JSON.stringify(privateJwk));

  // Generate client credentials
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();

  console.log('OAUTH_CLIENT_ID=' + clientId);
  console.log('OAUTH_CLIENT_SECRET=' + clientSecret);
  console.log('OAUTH_REDIRECT_URIS=https://your-domain.workers.dev/callback');
  console.log('OAUTH_ISSUER=https://your-domain.workers.dev');

  console.log('\n=== Client Registration Info ===');
  console.log('After deploying, you need to register this client via a one-time setup call:');
  console.log('POST https://your-domain.workers.dev/oauth/setup');
  console.log('Body: {');
  console.log('  "client_id": "' + clientId + '",');
  console.log('  "client_secret": "' + clientSecret + '",');
  console.log('  "redirect_uris": ["https://chatgpt-callback-url"]');
  console.log('}');
  console.log('\nOr use the client_id and client_secret when configuring ChatGPT OAuth connector.');
}

main().catch(console.error);
