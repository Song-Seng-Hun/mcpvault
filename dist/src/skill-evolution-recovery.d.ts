export interface SkillLockInspection {
    vaultPath: string;
    skillId: string;
    lockPath: string;
    marker: string;
    fingerprint: string;
}
export interface RecoverSkillLockOptions {
    vaultPath: string;
    skillId: string;
    expectedFingerprint: string;
    confirmOwnerStopped: true;
}
export type SkillLockRecovery = SkillLockInspection & {
    removed: true;
};
/** Host-only forensic inspection. This module is not part of the MCP surface. */
export declare function inspectSkillLock(vaultPath: string, skillId: string): Promise<SkillLockInspection>;
/**
 * Remove one exact leftover lock only after the host has independently stopped
 * its owner. No PID, age, lease, or timeout is treated as permission to steal.
 */
export declare function recoverSkillLock(options: RecoverSkillLockOptions): Promise<SkillLockRecovery>;
//# sourceMappingURL=skill-evolution-recovery.d.ts.map