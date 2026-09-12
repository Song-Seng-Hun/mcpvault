import { posix } from 'node:path';
import { guidanceError } from './guidance-runtime.js';
/** All scope-local source trees, including platform aliases, are append-only.
 * New captures use exclusive file creation; no permission can authorize replacing
 * an original. Ordinary knowledge paths do not acquire this restriction. */
export function isOriginalPath(value) {
    const path = posix.normalize(value.replace(/\\/g, '/').split('/').map(part => part === '.' || part === '..' ? part : part.replace(/[. ]+$/, '')).join('/')).toLowerCase();
    return path.split('/').includes('_sources');
}
export function assertOriginalMutation(path, exclusiveCreation = false) {
    if (isOriginalPath(path) && !exclusiveCreation) {
        throw guidanceError(new Error('Filesystem mutation cannot mutate immutable LLM Wiki sources; ingest a new original instead'), 'guid-bb37db8ee3892af1');
    }
}
