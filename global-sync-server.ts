import { startGlobalSyncHub } from './src/global-sync.js';

const root = process.argv[2] || process.env.MCPVAULT_GLOBAL_SYNC_ROOT;
const authToken = process.env.MCPVAULT_GLOBAL_SYNC_AUTH_TOKEN;
const reviewerToken = process.env.MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKEN;

if (!root) throw new Error('Usage: mcpvault-global-sync <hub-storage-root>');
if (!authToken || !reviewerToken) throw new Error('MCPVAULT_GLOBAL_SYNC_AUTH_TOKEN and MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKEN are required');

const handle = await startGlobalSyncHub(root, {
  host: process.env.MCPVAULT_GLOBAL_SYNC_HOST || '127.0.0.1',
  port: Number(process.env.MCPVAULT_GLOBAL_SYNC_PORT || 0),
  authToken,
  reviewerToken,
  ...(process.env.MCPVAULT_GLOBAL_SYNC_HUB_ID && { hubId: process.env.MCPVAULT_GLOBAL_SYNC_HUB_ID }),
});

console.error(`Global Sync Hub listening on http://${handle.host}:${handle.port}`);

const close = async () => {
  await handle.close();
  process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
