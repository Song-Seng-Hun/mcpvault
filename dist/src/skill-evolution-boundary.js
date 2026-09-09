import { guidanceError } from './guidance-runtime.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { posix } from 'node:path';
const writes = new AsyncLocalStorage();
const normalized = (path) => posix.normalize(path.replace(/\\/g, '/')).replace(/^\/+|\/+$/g, '').toLowerCase();
/** Only trusted service code grants one exact write, never a request or note. */
export function withSkillEvolutionWrite(path, operation) {
    return writes.run(normalized(path), operation);
}
export function assertSkillEvolutionMutationBoundary(path) {
    const target = normalized(path);
    const managed = /^community\/skills\/[^/]+\/_evolution(?:\/|$)/.test(target);
    const ancestor = target === 'community' || target === 'community/skills' || /^community\/skills\/[^/]+$/.test(target);
    if ((managed || ancestor) && writes.getStore() !== target)
        throw guidanceError(Error('Managed skill evolution records cannot be edited, moved or deleted through generic tools; use the skill endpoints'), 'guid-db06b2375c5a0663');
}
