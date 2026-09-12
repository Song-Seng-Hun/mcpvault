import { guidanceError } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { PathFilter } from './pathfilter.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { open, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { FrontmatterHandler } from './frontmatter.js';
import { isModerationHidden } from './moderation-policy.js';
import { assertEnterpriseStorageAccess } from './enterprise-storage-context.js';
import { resourceBundleLocation, parseResourceBundleManifest } from './resource-bundle.js';
import { withDocumentWork, reserveDocumentWork, documentWorkMemo, documentFrontmatterEstimate } from './document-work-memory.js';

export interface DocumentResourceSnapshot {
  path: string; bytes: Buffer; revision: string; mediaType: string; text?: string;
}

export interface DocumentRevision {
  readonly path: string; readonly revision: string; readonly byteLength: number;
}

interface BundleRevision {
  readonly member: DocumentRevision;
  readonly manifest: DocumentRevision;
}

const TEXT_MEDIA: Record<string, string> = {
  '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain',
  '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript', '.zsh': 'text/x-shellscript',
  '.ps1': 'text/plain', '.py': 'text/x-python', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.cjs': 'text/javascript', '.ts': 'text/plain', '.json': 'application/json',
  '.yaml': 'application/yaml', '.yml': 'application/yaml', '.toml': 'application/toml',
  '.csv': 'text/csv', '.ini': 'text/plain', '.cfg': 'text/plain', '.sql': 'text/plain',
  '.css': 'text/css', '.html': 'text/html', '.xml': 'application/xml', '.svg': 'image/svg+xml',
  '.base': 'application/yaml', '.canvas': 'application/json', '.fountain': 'text/plain',
};
const BINARY_MEDIA: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};
export function documentMedia(path: string): { mediaType: string; text: boolean } {
  const extension = extname(path).toLowerCase();
  if (Object.hasOwn(TEXT_MEDIA, extension)) return { mediaType: TEXT_MEDIA[extension]!, text: true };
  if (Object.hasOwn(BINARY_MEDIA, extension)) return { mediaType: BINARY_MEDIA[extension]!, text: false };
  if (/(?:^|\/)(?:license|copying)(?:\.[a-z0-9_-]+)?$/i.test(path)) return { mediaType: 'text/plain', text: true };
  return { mediaType: 'application/octet-stream', text: false };
}

/** Dedicated data-only reader. This does not broaden the ordinary note API or
 * grant execution, host-path, private-scope or managed-resource access. */
export class DocumentResourceReader {
  // read() binds a validated member to its manifest. Neither identity may come
  // from the caller's mutable snapshot during revalidation. Retain no bytes/text.
  private readonly bundleRevisions = new WeakMap<DocumentResourceSnapshot, BundleRevision>();
  private readonly sourceRevisions = new WeakMap<DocumentResourceSnapshot, DocumentRevision>();
  private readonly pins = new WeakMap<DocumentRevision, DocumentRevision | undefined>();

  constructor(readonly fs: FileSystemService, readonly filter: PathFilter, readonly access: ScopeAccessPolicy,
    readonly admitted: (path: string) => boolean = () => true) {}

  resolve(input: string, principal?: ScopePrincipal): string {
    if (typeof input !== 'string' || input.length > 500 || input !== input.trim()) throw guidanceError(new Error('Invalid document path'), 'guid-4227bee1a646d713');
    const path = this.access.resolveExternalPath(input, principal).replace(/\\/g, '/');
    if (!path || path.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f\x7f]/.test(part)
      || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw guidanceError(new Error('Invalid document path'), 'guid-4227bee1a646d713');
    if (!this.filter.isAllowedForListing(path) || !this.access.canAccessPhysicalPath(path, principal) || !this.admitted(path)) throw guidanceError(new Error('Document unavailable: access denied'), 'guid-5c944d79d84db6a0');
    assertEnterpriseStorageAccess(path);
    return path;
  }

  private canonical(path: string, principal?: ScopePrincipal): void {
    // path has already crossed resolveExternalPath. Resolving this physical
    // spelling again would reject an authorized scope://agent URI after expansion.
    if (!this.filter.isAllowedForListing(path) || !this.access.canAccessPhysicalPath(path, principal) || !this.admitted(path)) throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
    const actual = this.fs.canonicalReferencePath(path);
    const equal = process.platform === 'win32' ? actual.toLowerCase() === path.toLowerCase() : actual === path;
    if (!equal) throw guidanceError(new Error('Document canonical aliases and symbolic links are not permitted'), 'guid-3f434b864145afc9');
    if (!this.filter.isAllowedForListing(actual) || !this.access.canAccessPhysicalPath(actual, principal)) throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
    assertEnterpriseStorageAccess(actual);
  }

  /** Reauthorize a deferred derivative without retaining/decoding source bytes. */
  assertAdmitted(input: string, principal?: ScopePrincipal): string {
    const path = this.resolve(input, principal);
    this.canonical(path, principal);
    return path;
  }

  async read(input: string, principal?: ScopePrincipal, options: { expectedRevision?: string; maxBytes?: number; decodeText?: boolean } = {}): Promise<DocumentResourceSnapshot> {
    return withDocumentWork(async () => {
      const path = this.assertAdmitted(input, principal);
      const memo = documentWorkMemo<Promise<DocumentResourceSnapshot>>(this);
      const key = JSON.stringify([path, principal ?? null, options.expectedRevision, options.maxBytes, options.decodeText]);
      let pending = memo.get(key);
      const reused = pending !== undefined;
      if (!pending) {
        pending = this.readWithinWork(input, principal, options);
        memo.set(key, pending);
      }
      const original = await pending;
      if (reused) await this.assertCurrent(original, principal);
      this.assertAdmitted(input, principal);
      // Never lend the memo's mutable Buffer or wrapper to a caller.
      reserveDocumentWork(original.bytes.length + 512);
      const copy = { ...original, bytes: Buffer.from(original.bytes) };
      this.sourceRevisions.set(copy, this.sourceRevisions.get(original)!);
      const bundle = this.bundleRevisions.get(original);
      if (bundle) this.bundleRevisions.set(copy, bundle);
      return copy;
    });
  }

  private async readWithinWork(input: string, principal?: ScopePrincipal, options: { expectedRevision?: string; maxBytes?: number; decodeText?: boolean } = {}): Promise<DocumentResourceSnapshot> {
    const path = this.resolve(input, principal);
    const media = documentMedia(path), ceiling = media.mediaType === 'application/pdf' ? 50 * 1024 * 1024 : 8 * 1024 * 1024;
    const maxBytes = options.maxBytes ?? ceiling;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ceiling) throw guidanceError(new Error('Invalid document byte budget'), 'guid-cfd4d5b99b1b3c9b');
    if (options.expectedRevision !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedRevision)) throw guidanceError(new Error('Invalid document revision'), 'guid-5fa1120c58291289');
    this.canonical(path, principal);
    const fullPath = join(this.fs.getVaultPath(), path);
    const handle = await open(fullPath, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxBytes) throw guidanceError(new Error('Document byte budget exceeded or not a regular file'), 'guid-c06d934164e04bc6');
      // Contiguous bytes + caller copy + UTF-16 decode/moderation temporaries.
      // Allocate once: a short read must not retain a fresh 64 KiB backing store.
      reserveDocumentWork(before.size * (media.text ? 6 : 2) + 128 * 1024);
      const bytes = Buffer.allocUnsafe(before.size), probe = Buffer.allocUnsafe(1);
      let length = 0;
      for (;;) {
        const filled = length === bytes.length;
        const { bytesRead } = filled ? await handle.read(probe, 0, 1, null)
          : await handle.read(bytes, length, Math.min(64 * 1024, bytes.length - length), null);
        if (!bytesRead) break;
        length += bytesRead;
        if (length > maxBytes || length > before.size) throw guidanceError(new Error('Document byte budget exceeded or changed during snapshot read'), 'guid-5ffca210c6cbab4b');
      }
      if (length !== before.size) throw guidanceError(new Error('Document changed during snapshot read'), 'guid-4009a30550b5eaa1');
      const after = await handle.stat(), current = await stat(fullPath);
      for (const candidate of [after, current]) {
        if (before.size !== candidate.size || before.mtimeMs !== candidate.mtimeMs || before.ctimeMs !== candidate.ctimeMs
          || before.ino !== candidate.ino || before.dev !== candidate.dev) throw guidanceError(new Error('Document changed during snapshot read'), 'guid-4009a30550b5eaa1');
      }
      this.canonical(path, principal);
      const revision = createHash('sha256').update(bytes).digest('hex');
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) throw guidanceError(new Error('Stale document revision; reread the current outline'), 'guid-c5a49801a6dd4e7b');
      const bundle = resourceBundleLocation(path);
      let manifestRevision: DocumentRevision | undefined;
      if (bundle && bundle.relative !== 'manifest.md') {
        if (!bundle.relative.startsWith('files/')) throw guidanceError(new Error('Resource bundle member unavailable'), 'guid-f561038c0f652993');
        const metadata = await this.read(this.access.toPublicPath(`${bundle.root}/manifest.md`), principal, { maxBytes: 256 * 1024 });
        const manifest = parseResourceBundleManifest(metadata.text!, bundle.hash);
        const entry = manifest.entries.find(e => e.path === bundle.relative.slice(6));
        if (!entry || entry.status !== 'available' || entry.sha256 !== revision || entry.byteLength !== bytes.length) throw guidanceError(new Error('Resource bundle original hash mismatch or unavailable member'), 'guid-ae671ae1cd8a7579');
        manifestRevision = { path: metadata.path, revision: metadata.revision, byteLength: metadata.bytes.length };
      }
      const result: DocumentResourceSnapshot = { path, revision, bytes, mediaType: media.mediaType };
      // Raw export must still enforce Markdown/text moderation.
      if (media.text && (options.decodeText !== false || /\.(?:md|markdown|txt)$/i.test(path))) {
        try { result.text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { throw guidanceError(new Error('Document is not valid UTF-8; retrieve its original bytes instead'), 'guid-77a46a4da95b1c28'); }
        if (/\.(?:md|markdown|txt)$/i.test(path)) {
          // Outside FrontmatterHandler's tolerant syntax catch: budget failure
          // must never become a missing moderation flag / public fallback.
          reserveDocumentWork(documentFrontmatterEstimate(result.text));
          const parsed = new FrontmatterHandler().parse(result.text);
          if (isModerationHidden(parsed.frontmatter)) throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
        }
      }
      const sourceRevision = Object.freeze({ path, revision, byteLength: bytes.length });
      this.sourceRevisions.set(result, sourceRevision);
      if (manifestRevision) this.bundleRevisions.set(result, Object.freeze({
        member: sourceRevision,
        manifest: Object.freeze(manifestRevision),
      }));
      return result;
    } finally { await handle.close(); }
  }

  async assertCurrent(snapshot: DocumentResourceSnapshot, principal?: ScopePrincipal): Promise<void> {
    return withDocumentWork(() => this.assertCurrentWithinWork(snapshot, principal));
  }

  pin(snapshot: DocumentResourceSnapshot): DocumentRevision {
    const pin = this.sourceRevisions.get(snapshot);
    if (!pin || pin.path !== snapshot.path || pin.revision !== snapshot.revision || pin.byteLength !== snapshot.bytes.length) throw new Error('Document revision pin unavailable; reread the source');
    this.pins.set(pin, this.bundleRevisions.get(snapshot)?.manifest);
    return pin;
  }

  async assertPin(pin: DocumentRevision, principal?: ScopePrincipal): Promise<void> {
    if (!this.pins.has(pin)) throw new Error('Document revision pin unavailable; reread the source');
    return withDocumentWork(() => this.assertRevisionCurrent(pin, this.pins.get(pin), principal));
  }

  private async assertCurrentWithinWork(snapshot: DocumentResourceSnapshot, principal?: ScopePrincipal): Promise<void> {
    const pinned = this.bundleRevisions.get(snapshot), manifest = pinned?.manifest;
    if (pinned && (snapshot.path !== pinned.member.path || snapshot.revision !== pinned.member.revision
      || snapshot.bytes.length !== pinned.member.byteLength)) {
      throw guidanceError(new Error('Resource bundle original hash mismatch or unavailable member'), 'guid-ae671ae1cd8a7579');
    }
    await this.assertRevisionCurrent(pinned?.member ?? { path: snapshot.path, revision: snapshot.revision, byteLength: snapshot.bytes.length }, manifest, principal);
  }

  private async assertRevisionCurrent(source: DocumentRevision, manifest: DocumentRevision | undefined, principal?: ScopePrincipal): Promise<void> {
    const path = this.resolve(this.access.toPublicPath(source.path), principal);
    const bundle = resourceBundleLocation(path);
    if (bundle && bundle.relative !== 'manifest.md'
      && (!bundle.relative.startsWith('files/') || manifest?.path !== `${bundle.root}/manifest.md`)) {
      throw guidanceError(new Error('Resource bundle member unavailable; reread the original snapshot'), 'guid-f561038c0f652993');
    }
    const authorize = () => {
      this.canonical(path, principal);
      if (manifest) this.canonical(manifest.path, principal);
    };
    // Exact original hashes also detect changed moderation and NAS rewrites
    // whose size/mtime did not change. No second decode or parse is needed.
    await this.assertHashCurrent(source, authorize,
      manifest ? () => this.assertHashCurrent(manifest, authorize) : undefined);
    authorize();
  }

  private async assertHashCurrent(source: DocumentRevision, authorize: () => void, checkManifest?: () => Promise<void>): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(source.revision)) throw guidanceError(new Error('Invalid document revision'), 'guid-5fa1120c58291289');
    authorize();
    const fullPath = join(this.fs.getVaultPath(), source.path);
    const handle = await open(fullPath, 'r');
    try {
      authorize();
      const before = await handle.stat();
      authorize();
      if (!before.isFile() || before.size !== source.byteLength) throw guidanceError(new Error('Stale document revision; reread the current outline'), 'guid-c5a49801a6dd4e7b');
      reserveDocumentWork(64 * 1024);
      const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
      let length = 0;
      for (;;) {
        // Read at most one extra byte to detect growth without following an
        // unbounded append. The same fixed buffer is reused for every chunk.
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, source.byteLength - length + 1), null);
        authorize();
        if (!bytesRead) break;
        length += bytesRead;
        if (length > source.byteLength) throw guidanceError(new Error('Stale document revision; reread the current outline'), 'guid-c5a49801a6dd4e7b');
        hash.update(buffer.subarray(0, bytesRead));
      }
      if (length !== source.byteLength || hash.digest('hex') !== source.revision) throw guidanceError(new Error('Stale document revision; reread the current outline'), 'guid-c5a49801a6dd4e7b');
      if (checkManifest) {
        await checkManifest();
        authorize();
      }
      // Keep the source handle open across manifest validation so generation
      // changes there are checked too, including replacement of the pathname.
      const after = await handle.stat();
      authorize();
      const current = await stat(fullPath);
      authorize();
      for (const candidate of [after, current]) {
        if (!candidate.isFile() || before.size !== candidate.size || before.mtimeMs !== candidate.mtimeMs || before.ctimeMs !== candidate.ctimeMs
          || before.ino !== candidate.ino || before.dev !== candidate.dev) throw guidanceError(new Error('Document changed during snapshot read'), 'guid-4009a30550b5eaa1');
      }
    } finally { await handle.close(); }
    authorize();
  }
}
