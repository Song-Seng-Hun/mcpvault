import { createHash, type Hash } from 'node:crypto';

/** Streams admitted, masked rows only; storage scales with sources, not edges. */
export class NavigationViewFingerprint {
  private readonly sources = new Map<string, Hash>();
  constructor(private readonly identity: readonly string[]) {}

  add(path: string, revision: string, row: unknown): void {
    let hash = this.sources.get(path);
    if (!hash) { hash = createHash('sha256'); this.sources.set(path, hash); }
    hash.update(JSON.stringify([revision, row]));
  }

  finish(): string {
    const hash = createHash('sha256').update(JSON.stringify(['navigation-view-v1', ...this.identity]));
    for (const path of [...this.sources.keys()].sort()) {
      hash.update(JSON.stringify([path, this.sources.get(path)!.digest('hex')]));
    }
    return hash.digest('hex');
  }
}
