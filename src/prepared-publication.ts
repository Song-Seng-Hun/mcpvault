import { createHash } from 'node:crypto';
import { FrontmatterHandler } from './frontmatter.js';
import type { FileSystemService } from './filesystem.js';
import type { NoteWriteParams } from './types.js';

/** Canonical preview and existing guarded writer share the same validated write
 * parameters. The closure holds private copies; preview is not a bearer grant. */
export function preparePublicationWrite<T>(input: {
  fs: FileSystemService; write: NoteWriteParams; guards: Array<{ path: string; expectedRevision: string }>;
  assertAccess: () => void | Promise<void>; maxGuards?: number; projection: T;
}) {
  const write = structuredClone(input.write), guards = structuredClone(input.guards), projection = structuredClone(input.projection);
  const raw = new FrontmatterHandler().stringify(write.frontmatter || {}, write.content);
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  const revision = digest(raw), fingerprint = digest(JSON.stringify({ path: write.path, expectedRevision: write.expectedRevision, raw, guards }));
  return { raw, revision, fingerprint, apply: async (confirmedFingerprint: string) => {
    if (confirmedFingerprint !== fingerprint) throw Error('Prepared publication fingerprint changed');
    await input.assertAccess();
    const policy = { maxBytes: 8 * 1024 * 1024, assertAccess: input.assertAccess, ...(input.maxGuards && { maxGuards: input.maxGuards }) };
    const updated = guards.length
      ? await input.fs.writeNoteWithRevisionGuardsAndReceipt(write, guards, policy)
      : await input.fs.writeNoteWithReceipt(write, policy);
    if (updated.revision !== revision) throw Error('Publication output differs from prepared revision');
    return { ...projection, revision: updated.revision };
  } };
}
