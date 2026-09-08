import { guidanceError, guidanceText } from './guidance-runtime.js';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { normalizeScopeId } from './scopes.js';

export interface MemoryMigrationEntry {
  scope: 'user' | 'agent' | 'model';
  identity: string;
  path: string;
  disposition: 'keep-host-private' | 'ownership-review-required' | 'manual-agent-copy-candidate';
  verifiedOwner?: string;
}

/** Host-admin inventory only: never reads bodies, mutates files or grants access. */
export async function previewMemoryMigration(options: {
  vaultPath: string;
  verifiedAgents?: { agentId: string; userId: string }[];
  limit?: number;
}) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw guidanceError(new Error('limit must be 1-500'), 'guid-4c553b97a2dde7c2');
  const owners = new Map<string, string>();
  for (const binding of options.verifiedAgents ?? []) {
    const agent = normalizeScopeId(binding.agentId, 'agentId');
    const owner = normalizeScopeId(binding.userId, 'userId');
    if (owners.has(agent) && owners.get(agent) !== owner) throw guidanceError(new Error('Agent owner mapping is ambiguous'), 'guid-308e8cf09c94c200');
    owners.set(agent, owner);
  }
  const vault = await realpath(resolve(options.vaultPath));
  const entries: MemoryMigrationEntry[] = [];
  let truncated = false;
  for (const [folder, scope] of [['users', 'user'], ['agents', 'agent'], ['models', 'model']] as const) {
    const root = join(vault, '_scopes', folder);
    try {
      if ((await lstat(root)).isSymbolicLink()) throw guidanceError(new Error('Migration inventory refuses linked scope roots'), 'guid-8f6e68342fd88fa5');
      const canonical = await realpath(root);
      const rel = relative(vault, canonical);
      if (rel === '..' || rel.startsWith(`..${sep}`)) throw guidanceError(new Error('Migration scope escapes the Vault'), 'guid-c2b680c89157e5da');
      const directory = await opendir(root);
      for await (const item of directory) {
        if (!item.isDirectory() || item.isSymbolicLink()) continue;
        if (entries.length >= limit) { truncated = true; break; }
        let identity: string;
        try { identity = normalizeScopeId(item.name, 'identity'); } catch { continue; }
        const owner = scope === 'agent' ? owners.get(identity) : undefined;
        entries.push({ scope, identity, path: `_scopes/${folder}/${item.name}`,
          disposition: scope === 'user' ? 'keep-host-private' : owner ? 'manual-agent-copy-candidate' : 'ownership-review-required',
          ...(owner && { verifiedOwner: owner }),
        });
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (truncated) break;
  }
  return { automaticMigration: false as const, entries, shown: entries.length, truncated,
    guidance: guidanceText('guid-3c704b2154864c90', 'Legacy User files stay host-private. Re-enroll employees and runtimes, verify ownership, and explicitly review any copy into newly approved memory. Never infer owners from model names.') };
}
