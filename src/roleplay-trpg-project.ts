import { guidanceError } from './guidance-runtime.js';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { isRoleplaySheetPath, withRoleplayProjectionWrite } from './roleplay-boundary.js';
import { trpgArtifactSource, type TrpgArtifact } from './roleplay-trpg-projections.js';
import { validateJsonCanvasDocument } from './json-canvas.js';

const MAX_BYTES = 256 * 1024;
const kinds = ['sheet', 'canvas', 'base'] as const;
type Kind = typeof kinds[number];
interface Snapshot { kind: Kind; path: string; revision: string; content?: string; sourceRevision?: string }
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
function isMissing(error: unknown): boolean {
  for (let e = error, depth = 0; e instanceof Error && depth < 8; e = e.cause, depth++) if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
  return false;
}
/** The paths are server-generated; still apply path, scope, and every ancestor's symlink guards. */
async function admit(fs: FileSystemService, path: string, visible: (path: string) => boolean): Promise<void> {
  if (!isRoleplaySheetPath(path) || !new PathFilter().isAllowed(path) || !visible(path)) throw guidanceError(new Error('Roleplay projection unavailable'), 'guid-a147b847d4cfe90f');
  let absolute = fs.getVaultPath();
  for (const part of path.split('/')) {
    absolute = join(absolute, part);
    try { if ((await lstat(absolute)).isSymbolicLink()) throw guidanceError(new Error('Roleplay projection symbolic link unavailable'), 'guid-d5a8e20ee2c72128'); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
}
async function snapshot(fs: FileSystemService, file: TrpgArtifact, kind: Kind, characterId: string, visible: (path: string) => boolean): Promise<Snapshot> {
  await admit(fs, file.path, visible);
  try {
    const note = await fs.readNote(file.path, MAX_BYTES), content = note.originalContent;
    const sourceRevision = trpgArtifactSource({ path: file.path, content }, characterId);
    return { kind, path: file.path, content, revision: note.revision, ...(sourceRevision && { sourceRevision }) };
  } catch (error) { if (!isMissing(error)) throw error; return { kind, path: file.path, revision: 'missing' }; }
}
export async function trpgProjectionTargets(fs: FileSystemService, files: TrpgArtifact[], characterId: string, visible: (path: string) => boolean) {
  const targets = [];
  for (const [i, file] of files.entries()) {
    const { content: _content, ...target } = await snapshot(fs, file, kinds[i]!, characterId, visible);
    targets.push({ ...target, managed: !!target.sourceRevision });
  }
  return targets;
}

/** Bounded, revision-checked derived writes. No journal turn, deletion, or arbitrary caller path. */
export async function projectTrpgArtifacts(options: {
  fs: FileSystemService; files: TrpgArtifact[]; characterId: string; sourceRevision: string; expectedArtifacts: unknown;
  visible: (path: string) => boolean; assertCurrent: (checkSource: boolean) => Promise<void>; changed?: ((path: string) => void) | undefined;
}) {
  const { fs, files, characterId, sourceRevision, visible, assertCurrent } = options;
  const expected = options.expectedArtifacts as Record<string, unknown>;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) || Object.keys(expected).length !== 3 || !kinds.every(k => expected[k] === 'missing' || typeof expected[k] === 'string' && /^[a-f0-9]{64}$/.test(expected[k] as string))) throw guidanceError(new Error('All three projection target revisions are required'), 'guid-d58fdc6b94a7da05');
  if (files.length !== 3) throw guidanceError(new Error('Invalid projection bundle'), 'guid-1f70c95e79868127');
  await assertCurrent(true);
  const before: Snapshot[] = [];
  for (const [i, file] of files.entries()) {
    if (Buffer.byteLength(file.content) > MAX_BYTES || trpgArtifactSource(file, characterId) !== sourceRevision) throw guidanceError(new Error('Invalid or oversized generated projection'), 'guid-08493909a235700e');
    if (file.path.endsWith('.canvas')) validateJsonCanvasDocument(JSON.parse(file.content));
    const prior = await snapshot(fs, file, kinds[i]!, characterId, visible);
    if (prior.content !== undefined && !prior.sourceRevision) throw guidanceError(new Error('Refusing to overwrite unmanaged or manually edited projection'), 'guid-c600cefe04b272e3');
    if (prior.content !== file.content && prior.revision !== expected[prior.kind]) throw guidanceError(new Error('Projection target revision conflict; export again'), 'guid-1622d8759067139a');
    before.push(prior);
  }
  const attempted: number[] = [];
  const write = async (file: TrpgArtifact, expectedRevision: string, checkSource: boolean) => withRoleplayProjectionWrite(file.path, () => fs.writeNoteWithReceipt({ ...file, expectedRevision }, {
    maxBytes: MAX_BYTES, assertAccess: async () => { await assertCurrent(checkSource); await admit(fs, file.path, visible); },
  }));
  try {
    for (const [i, file] of files.entries()) {
      await assertCurrent(true);
      if (before[i]!.content === file.content) continue;
      attempted.push(i);
      await write(file, before[i]!.revision, true);
      options.changed?.(file.path);
    }
    const targets = await trpgProjectionTargets(fs, files, characterId, visible);
    if (targets.some((target, i) => target.revision !== hash(files[i]!.content))) throw guidanceError(new Error('Projection target revision changed during write'), 'guid-f7e53418495b963f');
    await assertCurrent(true);
    return { projected: true, sourceRevision, files: targets.map(({ kind, path, revision }) => ({ kind, path, revision })) };
  } catch (error) {
    let incomplete = false;
    const preserved: string[] = [];
    for (const i of [...attempted].reverse()) {
      const prior = before[i]!, file = files[i]!;
      try {
        await assertCurrent(false);
        const current = await snapshot(fs, file, prior.kind, characterId, visible);
        if (current.revision === prior.revision) continue;
        if (prior.content === undefined) { if (current.revision !== 'missing') preserved.push(file.path); continue; }
        if (current.revision !== hash(file.content)) { incomplete = true; continue; }
        await write({ path: file.path, content: prior.content }, current.revision, false);
        options.changed?.(file.path);
        if (await fs.readNoteRevision(file.path) !== prior.revision) incomplete = true;
      } catch { incomplete = true; }
    }
    // No deletion, even after failed first creation. Existing foreign edits always win.
    const reason = error instanceof Error ? error.message.slice(0, 180) : 'write failed';
    throw guidanceError(new Error(`Projection failed (${reason}); ${incomplete ? 'rollback incomplete; inspect target revisions' : 'existing preimages restored'}${preserved.length ? `; new files preserved: ${preserved.join(', ')}` : ''}. Export current targets before retrying.`), 'guid-e8f403850dae4dc9');
  }
}
