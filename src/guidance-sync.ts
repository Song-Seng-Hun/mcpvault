import { guidanceHash, guidanceSourceRevision, serializeGuidanceNote } from './guidance-catalog.js';
import type { GuidanceCatalog } from './guidance-catalog.js';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';

type Action = 'create' | 'update_default' | 'unchanged' | 'preserve' | 'source_conflict' | 'collision';
interface Change { id: string; path: string; action: Action; revision: string; sourceRevision: string }
/** Explicit host operation, never an agent endpoint or a periodic full scan. */
export class GuidanceSync {
  private readonly fs: FileSystemService;
  private readonly fm = new FrontmatterHandler();
  constructor(vaultPath: string, private readonly catalog: GuidanceCatalog) { this.fs = new FileSystemService(vaultPath); }
  async preview() {
    const changes: Change[] = [];
    for (const d of this.catalog.definitions) {
      const path = this.catalog.pathFor(d.id), sourceRevision = guidanceSourceRevision(d);
      this.catalog.checkedPath(path);
      const inspection = this.catalog.inspect(d.id);
      if (inspection.status === 'missing') { changes.push({ id: d.id, path, action: 'create', revision: 'missing', sourceRevision }); continue; }
      if (inspection.status === 'disabled' || inspection.status === 'invalid') {
        changes.push({ id: d.id, path, action: 'collision', revision: inspection.revision ?? 'unavailable', sourceRevision }); continue;
      }
      const note = await this.fs.readNote(path, 65536);
      const originalDefault = guidanceHash(note.content.trim()) === note.frontmatter.guidance_default_body_revision;
      const currentSource = note.frontmatter.guidance_source_revision === sourceRevision;
      const action = currentSource ? (originalDefault ? 'unchanged' : 'preserve') : (originalDefault ? 'update_default' : 'source_conflict');
      changes.push({ id: d.id, path, action, revision: note.revision, sourceRevision });
    }
    return { fingerprint: guidanceHash(JSON.stringify(changes)), changes };
  }
  async apply(fingerprint: string) {
    const preview = await this.preview();
    if (fingerprint !== preview.fingerprint) throw new Error('Guidance sync preview changed; review a fresh preview');
    const results: Array<{ id: string; action: Action; revision?: string }> = [];
    // Individual CAS writes, never claim an atomic multi-file update. A failed
    // batch can be safely previewed again; completed files become unchanged.
    for (const change of preview.changes) {
      if (!['create', 'update_default'].includes(change.action)) { results.push({ id: change.id, action: change.action }); continue; }
      this.catalog.checkedPath(change.path);
      const d = this.catalog.definition(change.id)!;
      const parsed = this.fm.parse(serializeGuidanceNote(d));
      const previous = change.action === 'create' ? {} : (await this.fs.readNote(change.path, 65536)).frontmatter;
      const receipt = await this.fs.writeNoteWithReceipt({ path: change.path, content: parsed.content,
        frontmatter: { ...previous, ...parsed.frontmatter }, expectedRevision: change.revision });
      results.push({ id: change.id, action: change.action, revision: receipt.revision });
    }
    return results;
  }
}
