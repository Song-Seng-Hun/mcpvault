import { startGlobalSyncHub } from './src/global-sync.js';

const root = process.argv[2] || process.env.MCPVAULT_GLOBAL_SYNC_ROOT;
const authToken = process.env.MCPVAULT_GLOBAL_SYNC_AUTH_TOKEN;
const reviewerToken = process.env.MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKEN;
const reviewerTokensRaw = process.env.MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKENS;

if (!root) throw new Error('Usage: mcpvault-global-sync <hub-storage-root>');
if (!authToken || !reviewerToken) throw new Error('MCPVAULT_GLOBAL_SYNC_AUTH_TOKEN and MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKEN are required');

let reviewerTokens: Record<string, string> | undefined;
if (reviewerTokensRaw) {
  const parsed: unknown = JSON.parse(reviewerTokensRaw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKENS must be a JSON object');
  reviewerTokens = parsed as Record<string, string>;
}

const handle = await startGlobalSyncHub(root, {
  host: process.env.MCPVAULT_GLOBAL_SYNC_HOST || '127.0.0.1',
  port: Number(process.env.MCPVAULT_GLOBAL_SYNC_PORT || 0),
  authToken,
  reviewerToken,
  ...(reviewerTokens && { reviewerTokens }),
  ...(process.env.MCPVAULT_GLOBAL_SYNC_HUB_ID && { hubId: process.env.MCPVAULT_GLOBAL_SYNC_HUB_ID }),
  ...(process.env.MCPVAULT_GLOBAL_SYNC_SIGNING_KEY_PATH && { signingKeyPath: process.env.MCPVAULT_GLOBAL_SYNC_SIGNING_KEY_PATH }),
});

console.error(`Global Sync Hub listening on http://${handle.host}:${handle.port}`);
console.error(`Global Sync Hub public signing key (pin this on replicas):\n${handle.hub.getPublicKey()}`);

const close = async () => {
  await handle.close();
  process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
