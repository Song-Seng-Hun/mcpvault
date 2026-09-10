import { guidanceError } from './guidance-runtime.js';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Exclude every enclosing package, including the source checkout around a
 * frozen .mcpvault/deployments/.../dist runtime. No secret data is read here. */
export async function hostSourceRoots(moduleUrl) {
    try {
        return await enclosingPackages(moduleUrl);
    }
    catch {
        throw guidanceError(new Error('Host source boundaries unavailable; private storage cannot be verified'), 'guid-db7246fe11580b76');
    }
}
async function enclosingPackages(moduleUrl) {
    let current = dirname(dirname(fileURLToPath(moduleUrl)));
    const roots = new Set([await realpath(current)]);
    while (true) {
        try {
            if ((await lstat(join(current, 'package.json'))).isFile())
                roots.add(await realpath(current));
        }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
                throw error;
        }
        const parent = dirname(current);
        if (parent === current)
            return [...roots];
        current = parent;
    }
}
