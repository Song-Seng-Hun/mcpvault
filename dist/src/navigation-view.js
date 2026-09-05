import { createHash } from 'node:crypto';
/** Streams admitted, masked rows only; storage scales with sources, not edges. */
export class NavigationViewFingerprint {
    identity;
    sources = new Map();
    constructor(identity) {
        this.identity = identity;
    }
    add(path, revision, row) {
        let hash = this.sources.get(path);
        if (!hash) {
            hash = createHash('sha256');
            this.sources.set(path, hash);
        }
        hash.update(JSON.stringify([revision, row]));
    }
    finish() {
        const hash = createHash('sha256').update(JSON.stringify(['navigation-view-v1', ...this.identity]));
        for (const path of [...this.sources.keys()].sort()) {
            hash.update(JSON.stringify([path, this.sources.get(path).digest('hex')]));
        }
        return hash.digest('hex');
    }
}
