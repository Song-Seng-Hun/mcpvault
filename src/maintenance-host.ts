import { PathFilter } from './pathfilter.js';
import { loadHostWorkStorage, type HostWorkStorage } from './host-work-storage.js';

export const MAINTENANCE_OPERATIONS = ['cache_refresh', 'managed_canvas_regenerate', 'moved_link_repair'] as const;
export type MaintenanceOperation = typeof MAINTENANCE_OPERATIONS[number];
export interface MaintenanceConfig {
  version: 1;
  enabled: boolean;
  accountId: string;
  paths: string[];
  operations: MaintenanceOperation[];
}
export interface MaintenanceWriter { assertHeld(): Promise<void>; close(): Promise<void> }
export interface MaintenanceHost {
  refresh(): Promise<MaintenanceConfig>;
  readState(): Promise<unknown | undefined>;
  writeState(value: unknown): Promise<void>;
  acquire(): Promise<MaintenanceWriter>;
}
export const MAX_MAINTENANCE_STATE_BYTES = 4 * 1024 * 1024;

/** Exact logical paths only. No inherited folder, wildcard or model authority. */
export function validateMaintenanceConfig(value: unknown): MaintenanceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid maintenance configuration');
  const raw = value as Record<string, unknown>;
  const keys = ['version', 'enabled', 'accountId', 'paths', 'operations'];
  if (Object.keys(raw).some(key => !keys.includes(key)) || raw.version !== 1 || typeof raw.enabled !== 'boolean'
    || typeof raw.accountId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(raw.accountId)) throw new Error('Maintenance requires an explicit current account and supported configuration fields');
  const filter = new PathFilter();
  if (!Array.isArray(raw.paths) || raw.paths.length < 1 || raw.paths.length > 128) throw new Error('Maintenance requires 1..128 exact paths');
  const paths = raw.paths.map(path => {
    if (typeof path !== 'string' || !path || path.length > 400 || /[\\:*?"<>|\x00-\x1f]/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || !filter.isAllowed(path)) throw new Error('Maintenance path must be exact, canonical and permitted');
    return path;
  });
  if (new Set(paths.map(path => path.toLowerCase())).size !== paths.length) throw new Error('Maintenance paths must be unique');
  if (!Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > 3
    || raw.operations.some(op => !(MAINTENANCE_OPERATIONS as readonly unknown[]).includes(op))
    || new Set(raw.operations).size !== raw.operations.length) throw new Error('Maintenance operations must be an explicit fixed allow list');
  return { version: 1, enabled: raw.enabled, accountId: raw.accountId, paths, operations: [...raw.operations] as MaintenanceOperation[] };
}

/** Host-only durable receipts/backups; never use a Vault/repository fallback. */
export async function loadMaintenanceHostConfig(path: string, expectedVault: string): Promise<MaintenanceHost> {
  const storage: HostWorkStorage<MaintenanceConfig> = await loadHostWorkStorage(path, expectedVault, {
    namespace: 'maintenance', maxStateBytes: MAX_MAINTENANCE_STATE_BYTES,
    validate: validateMaintenanceConfig,
  });
  return storage;
}
