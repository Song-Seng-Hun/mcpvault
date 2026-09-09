export declare const ROLEPLAY_HOST_IDENTITY_FILE = "roleplay-host-identity.json";
export declare const roleplayIsUNC: (path: string) => boolean;
export declare const roleplayInside: (root: string, path: string) => boolean;
/** Inspect lexical ancestors BEFORE realpath can hide a junction. Host-provisioned
 * roots must exist; device namespaces and dot segments are not storage aliases. */
export declare function canonicalRoleplayPath(path: string, local: boolean, file?: boolean): Promise<string>;
export declare function validateRoleplayStorage(options: {
    vaultPath: string;
    hostPath: string;
}): Promise<{
    vaultPath: string;
    hostPath: string;
}>;
/** Durable, random identity provisioned only in the verified LOCAL host directory.
 * Preserve it across restarts. Do not copy it to another host with a checkpoint.
 * Hostname binding additionally fails closed on a moved file or renamed host;
 * uniqueness comes from the local UUID, not hostname or PID. Empty/torn files
 * are forensic failures and are never regenerated automatically. */
export declare function roleplayHostIdentity(hostPath: string, create?: boolean): Promise<string | undefined>;
export declare function assertRoleplayRecoveryHost(vault: string, writerHost: unknown, localHost: string | undefined): void;
//# sourceMappingURL=roleplay-storage-host.d.ts.map