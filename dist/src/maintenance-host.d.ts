export declare const MAINTENANCE_OPERATIONS: readonly ['cache_refresh', 'managed_canvas_regenerate', 'moved_link_repair'];
export type MaintenanceOperation = typeof MAINTENANCE_OPERATIONS[number];
export interface MaintenanceConfig {
    version: 1;
    enabled: boolean;
    accountId: string;
    paths: string[];
    operations: MaintenanceOperation[];
}
export interface MaintenanceWriter {
    assertHeld(): Promise<void>;
    close(): Promise<void>;
}
export interface MaintenanceHost {
    refresh(): Promise<MaintenanceConfig>;
    readState(): Promise<unknown | undefined>;
    writeState(value: unknown): Promise<void>;
    acquire(): Promise<MaintenanceWriter>;
}
export declare const MAX_MAINTENANCE_STATE_BYTES: number;
/** Exact logical paths only. No inherited folder, wildcard or model authority. */
export declare function validateMaintenanceConfig(value: unknown): MaintenanceConfig;
/** Host-only durable receipts/backups; never use a Vault/repository fallback. */
export declare function loadMaintenanceHostConfig(path: string, expectedVault: string): Promise<MaintenanceHost>;
//# sourceMappingURL=maintenance-host.d.ts.map