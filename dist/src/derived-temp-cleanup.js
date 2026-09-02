import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
/**
 * Remove only abandoned atomic-write temporary files from derived state.
 *
 * These files are never authoritative. A PID embedded in the filename lets
 * us leave a live writer alone while cleaning up files left by a crashed or
 * forcibly terminated process on the next server start.
 */
export async function cleanupStaleDerivedTemps(vaultPath) {
    const directories = [
        join(vaultPath, '.mcpvault'),
        join(vaultPath, '.mcpvault', 'semantic-index'),
    ];
    for (const directory of directories) {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            const match = /\.(\d+)\.tmp$/i.exec(entry.name);
            if (!match)
                continue;
            const pid = Number(match[1]);
            if (!Number.isSafeInteger(pid) || pid <= 0 || processIsAlive(pid))
                continue;
            await unlink(join(directory, entry.name)).catch(() => undefined);
        }
    }
}
function processIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        // EPERM means the process exists but this process cannot inspect it.
        // Treat it as live so cleanup never races an unrelated writer.
        return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EPERM');
    }
}
