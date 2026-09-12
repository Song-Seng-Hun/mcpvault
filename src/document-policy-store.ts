import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { open, lstat, unlink } from 'node:fs/promises';
import { FrontmatterHandler } from './frontmatter.js';
import { readFederationFile, writeFederationFileAtomic } from './public-federation-storage.js';
import { DocumentAuthority, documentPolicyPath, type DocumentAccessRule } from './document-authority.js';
import { isOriginalPath } from './original-boundary.js';

export const DOCUMENT_POLICY_PATH = '_wiki/_policies/documents.md';
const unavailable = () => new Error('Protected document policy unavailable; host review required');

/** Authoritative Markdown metadata, deliberately outside the generic note API.
 * No raw original is changed and no request can claim or downgrade its rules.
 * Each request refreshes before work and before returning, including on NAS.
 * Compiled definitions are reused only for exactly the same policy bytes. */
export class DocumentPolicyStore {
  private definition: readonly DocumentAccessRule[] = Object.freeze([]);
  private digest: string | undefined;
  private seen = false;
  private ready = false;
  private queue: Promise<void> = Promise.resolve();
  private content = '';

  constructor(private readonly vault: string) {}

  rules(): readonly DocumentAccessRule[] {
    if (!this.ready) throw unavailable();
    return this.definition;
  }

  revision(): string | 'missing' {
    this.rules();
    return this.digest ?? 'missing';
  }

  refresh(): Promise<void> {
    // A final refresh must not reuse a read that began before it was requested.
    this.queue = this.queue.then(() => this.read(), () => this.read());
    return this.queue;
  }

  private async read(): Promise<void> {
      try {
        let content: string;
        try { content = await readFederationFile(this.vault, join(this.vault, DOCUMENT_POLICY_PATH), { maxBytes: 2 * 1024 * 1024 }); }
        catch (error) {
          if (!this.seen && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            this.ready = true;
            return;
          }
          throw unavailable();
        }
        this.seen = true;
        const digest = createHash('sha256').update(content).digest('hex');
        if (digest !== this.digest) {
          const { frontmatter } = new FrontmatterHandler().parse(content);
          if (frontmatter.type !== 'protected-document-policy' || frontmatter.version !== 1
            || !Array.isArray(frontmatter.rules) || Object.keys(frontmatter).some(k => !['type', 'version', 'rules'].includes(k))) throw unavailable();
          const authority = new DocumentAuthority(frontmatter.rules);
          this.definition = authority.rules;
          this.digest = digest;
          this.content = content;
        }
        this.ready = true;
      } catch {
        this.ready = false;
        throw unavailable();
      }
  }

  /** Trusted writer: can only ADD inherited restrictions, never relax or edit
   * source classifications. Persist before writing a derivative's body. A failed
   * later write may leave conservative metadata, never a public partial body. */
  async inherit(targetInput: string, sourceInputs: readonly string[], expectedRevision: string): Promise<void> {
    const target = documentPolicyPath(targetInput);
    if (isOriginalPath(target)) throw new Error('Original classification cannot be changed by derivative inheritance');
    if (!Array.isArray(sourceInputs) || !sourceInputs.length || sourceInputs.length > 32) throw new Error('Derived sources must be a bounded nonempty list');
    const sources = [...new Set(sourceInputs.map(documentPolicyPath))];
    if (sources.includes(target)) throw new Error('Cyclic derived document policy');
    const update = async () => {
      await this.read();
      if (this.revision() !== expectedRevision) throw new Error('Protected document policy revision changed');
      const lockPath = join(this.vault, '_wiki', '_policies', '.documents.lock');
      let lock: Awaited<ReturnType<typeof open>>;
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch { throw new Error('Protected document policy is locked; retry or ask the host to inspect an interrupted writer'); }
      const identity = await lock.stat();
      try {
        await this.read();
        if (this.revision() !== expectedRevision) throw new Error('Protected document policy revision changed');
        const existing = this.definition.find(rule => rule.path === target);
        // Equal audiences today are not proof they will stay equal tomorrow.
        // Keep ancestry even when current constraints happen to coincide.
        const needed = sources.filter(source => !existing?.derivedFrom?.includes(source));
        if (!needed.length) return;
        const derivedFrom = [...new Set([...(existing?.derivedFrom ?? []), ...needed])];
        const rules = [...this.definition.filter(rule => rule.path !== target), { ...existing, path: target, derivedFrom }];
        const next = new DocumentAuthority(rules);
        const body = new FrontmatterHandler().updateFrontmatter(this.content, { rules: next.rules });
        // Check the authoritative revision again after preparation. The lock is
        // cross-process; out-of-band NAS edits still cause a conflict on reread.
        await this.read();
        if (this.revision() !== expectedRevision) throw new Error('Protected document policy revision changed');
        await writeFederationFileAtomic(this.vault, join(this.vault, DOCUMENT_POLICY_PATH), body, { maxBytes: 2 * 1024 * 1024 });
        await this.read();
        if (this.digest !== createHash('sha256').update(body).digest('hex')) throw new Error('Protected document policy changed while committing inheritance');
      } finally {
        await lock.close();
        // Never remove a replacement lock belonging to another writer.
        const present = await lstat(lockPath).catch(() => undefined);
        if (present && !present.isSymbolicLink() && present.ino === identity.ino && present.dev === identity.dev) await unlink(lockPath);
      }
    };
    this.queue = this.queue.then(update, update);
    return this.queue;
  }
}
