declare const HOST_WORK_NAMESPACES: readonly ['maintenance', 'compilation', 'codex-hooks', 'codex-checkpoints'];
export type HostWorkNamespace = typeof HOST_WORK_NAMESPACES[number];
export interface HostWorkWriter {
    assertHeld(): Promise<void>;
    close(): Promise<void>;
}
export interface HostWorkStorage<T extends {
    enabled: boolean;
}> {
    refresh(): Promise<T>;
    readState(): Promise<unknown | undefined>;
    writeState(value: unknown): Promise<void>;
    acquire(): Promise<HostWorkWriter>;
}
export declare function loadHostWorkStorage<T extends {
    enabled: boolean;
}>(path: string, expectedVault: string, options: {
    namespace: HostWorkNamespace;
    maxStateBytes: number;
    validate: (value: unknown) => T;
}): Promise<HostWorkStorage<T>>;
export {};
//# sourceMappingURL=host-work-storage.d.ts.map