import { startGlobalSyncHub } from './src/global-sync.js';
import { readFile } from 'node:fs/promises';
const root = process.argv[2] || process.env.MCPVAULT_GLOBAL_SYNC_ROOT;
const authToken = process.env.MCPVAULT_GLOBAL_SYNC_AUTH_TOKEN;
const reviewerToken = process.env.MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKEN;
const adminToken = process.env.MCPVAULT_GLOBAL_SYNC_ADMIN_TOKEN;
const reviewerTokensRaw = process.env.MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKENS;
const reviewerExpiresRaw = process.env.MCPVAULT_GLOBAL_SYNC_REVIEWER_EXPIRES_AT;
const tlsKeyPath = process.env.MCPVAULT_GLOBAL_SYNC_TLS_KEY_PATH;
const tlsCertPath = process.env.MCPVAULT_GLOBAL_SYNC_TLS_CERT_PATH;
const tlsCaPath = process.env.MCPVAULT_GLOBAL_SYNC_TLS_CA_PATH;
const hubId = process.env.MCPVAULT_GLOBAL_SYNC_HUB_ID || 'global-hub';
const proposerOrigin = process.env.MCPVAULT_GLOBAL_SYNC_ORIGIN || hubId;
if (!root)
    throw new Error('Usage: mcpvault-global-sync <hub-storage-root>');
if (!authToken || !reviewerToken)
    throw new Error('MCPVAULT_GLOBAL_SYNC_AUTH_TOKEN and MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKEN are required');
if (Boolean(tlsKeyPath) !== Boolean(tlsCertPath))
    throw new Error('MCPVAULT_GLOBAL_SYNC_TLS_KEY_PATH and MCPVAULT_GLOBAL_SYNC_TLS_CERT_PATH must be provided together');
let reviewerTokens;
if (reviewerTokensRaw) {
    const parsed = JSON.parse(reviewerTokensRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('MCPVAULT_GLOBAL_SYNC_REVIEWER_TOKENS must be a JSON object');
    reviewerTokens = parsed;
}
let reviewerTokenExpiresAt;
if (reviewerExpiresRaw) {
    const parsed = JSON.parse(reviewerExpiresRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('MCPVAULT_GLOBAL_SYNC_REVIEWER_EXPIRES_AT must be a JSON object');
    reviewerTokenExpiresAt = parsed;
}
const tls = tlsKeyPath && tlsCertPath
    ? {
        key: await readFile(tlsKeyPath, 'utf8'),
        cert: await readFile(tlsCertPath, 'utf8'),
        ...(tlsCaPath && { ca: await readFile(tlsCaPath, 'utf8'), requestCert: true, rejectUnauthorized: true }),
    }
    : undefined;
const handle = await startGlobalSyncHub(root, {
    host: process.env.MCPVAULT_GLOBAL_SYNC_HOST || '127.0.0.1',
    port: Number(process.env.MCPVAULT_GLOBAL_SYNC_PORT || 0),
    authToken,
    reviewerToken,
    ...(adminToken && { adminToken }),
    ...(process.env.MCPVAULT_GLOBAL_SYNC_ADMIN_EXPIRES_AT && { adminTokenExpiresAt: process.env.MCPVAULT_GLOBAL_SYNC_ADMIN_EXPIRES_AT }),
    ...(process.env.MCPVAULT_GLOBAL_SYNC_AUTH_EXPIRES_AT && { authTokenExpiresAt: process.env.MCPVAULT_GLOBAL_SYNC_AUTH_EXPIRES_AT }),
    ...(reviewerTokens && { reviewerTokens }),
    ...(reviewerTokenExpiresAt && { reviewerTokenExpiresAt }),
    hubId,
    ...(process.env.MCPVAULT_GLOBAL_SYNC_SIGNING_KEY_PATH && { signingKeyPath: process.env.MCPVAULT_GLOBAL_SYNC_SIGNING_KEY_PATH }),
    proposerOrigin,
    ...(tls && { tls }),
});
console.error(`Global Sync Hub listening on ${tls ? 'https' : 'http'}://${handle.host}:${handle.port}`);
console.error(`Global Sync Hub public signing key (pin this on replicas):\n${handle.hub.getPublicKey()}`);
const close = async () => {
    await handle.close();
    process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
