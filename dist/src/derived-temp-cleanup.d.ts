/**
 * Remove only abandoned atomic-write temporary files from derived state.
 *
 * These files are never authoritative. A PID embedded in the filename lets
 * us leave a live writer alone while cleaning up files left by a crashed or
 * forcibly terminated process on the next server start.
 */
export declare function cleanupStaleDerivedTemps(vaultPath: string): Promise<void>;
//# sourceMappingURL=derived-temp-cleanup.d.ts.map