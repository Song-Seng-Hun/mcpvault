import { guidanceError } from './guidance-runtime.js';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { isModerationHidden } from './moderation-policy.js';
import { FrontmatterHandler } from './frontmatter.js';
import { withStoryWrite } from './story-boundary.js';
import { storyHash, storyId, storyPath, storyRevision, type StoryGuard, type StoryNote, type StoryParams } from './story-model.js';

interface StoryRequest { id: string; actor: string; action: string; payload: string }
const stateHash = (fm: StoryParams, content: string) => { const { story_receipts: _receipts, ...state } = fm; return storyHash({ state, content }); };

/** Markdown owns both content and bounded retry receipts. No second database. */
export class StoryStore {
  constructor(readonly fs: FileSystemService, readonly access: ScopeAccessPolicy) {}

  async read(path: string, principal?: ScopePrincipal, optional = false): Promise<StoryNote | undefined> {
    const normalized = storyPath(this.access.resolveExternalPath(path, principal));
    if (!this.access.canAccessPhysicalPath(normalized, principal)) throw guidanceError(new Error('Story target unavailable'), 'guid-c956ec1a110365b0');
    if (!await this.fs.noteExists(normalized)) { if (optional) return; throw guidanceError(new Error('Story target unavailable'), 'guid-c956ec1a110365b0'); }
    const canonical = this.fs.canonicalReferencePath(normalized);
    if (canonical.toLowerCase() !== normalized.toLowerCase() || !this.access.canAccessPhysicalPath(canonical, principal)) throw guidanceError(new Error('Story canonical alias is unavailable in this scope'), 'guid-a3f35e53c6d2b6bf');
    const note = await this.fs.readNote(normalized, 512000);
    if (this.fs.canonicalReferencePath(normalized).toLowerCase() !== canonical.toLowerCase() || !this.access.canAccessPhysicalPath(canonical, principal)) throw guidanceError(new Error('Story target changed during read'), 'guid-df7fd365c37c0207');
    if (isModerationHidden(note.frontmatter) || !note.revision) throw guidanceError(new Error('Story target unavailable'), 'guid-c956ec1a110365b0');
    return { ...note, path: normalized, revision: note.revision };
  }

  request(action: string, params: StoryParams, principal: ScopePrincipal): StoryRequest {
    const { accessToken: _token, maxChars: _budget, limit: _limit, cursor: _cursor, ...payload } = params;
    return { id: storyId(params.requestId, 'requestId'), actor: principal.accountId, action, payload: storyHash(payload) };
  }

  retry(note: StoryNote | undefined, request: StoryRequest): StoryParams | undefined {
    const receipt = (note?.frontmatter.story_receipts ?? []).find((r: StoryParams) => r.actor === request.actor && r.id === request.id && r.action === request.action);
    if (!receipt) return;
    if (receipt.payload !== request.payload) throw guidanceError(new Error('requestId already used with a different payload'), 'guid-e4113e04ec49a0bc');
    const unchanged = receipt.state === stateHash(note!.frontmatter, note!.content)
      && new FrontmatterHandler().stringify(note!.frontmatter, note!.content) === note!.originalContent;
    if (receipt.invalid || (!receipt.revision && !unchanged)) throw guidanceError(new Error('Receipt unavailable after external Markdown edit; reread changed story'), 'guid-feed735d46b25e41');
    return { ...structuredClone(receipt.result), revision: receipt.revision || note!.revision, replayed: true };
  }

  async write(path: string, fm: StoryParams, content: string, expectedRevision: unknown, request: StoryRequest,
    result: StoryParams, guards: StoryGuard[], assertAccess: () => Promise<void>, prior?: StoryNote): Promise<StoryParams> {
    storyRevision(expectedRevision, true);
    const receipts = structuredClone(prior?.frontmatter.story_receipts ?? []) as StoryParams[];
    const previous = receipts.at(-1);
    if (previous && !previous.revision) {
      if (previous.state === stateHash(prior!.frontmatter, prior!.content)) previous.revision = prior!.revision;
      else previous.invalid = true;
    }
    const next = { ...fm, updated_at: new Date().toISOString() };
    // gray-matter normalizes the final body newline. Hash the exact persisted
    // body rather than mistaking its serialization for an external edit.
    content = new FrontmatterHandler().parse(new FrontmatterHandler().stringify(next, content)).content;
    const receipt = { ...request, result, state: stateHash(next, content) };
    const frontmatter = { ...next, story_receipts: [...receipts.slice(-15), receipt] };
    // Include UTF-8 expansion, YAML overhead and retained receipts before the
    // first write. Every stored record must remain readable by this service.
    if (Buffer.byteLength(new FrontmatterHandler().stringify(frontmatter, content), 'utf8') > 500000) throw guidanceError(new Error('Story record exceeds the 500000-byte storage budget'), 'guid-58451fd7ab4222fc');
    const byPath = new Map<string, StoryGuard>();
    for (const guard of guards) {
      const key = storyPath(guard.path).toLowerCase();
      const previousGuard = byPath.get(key);
      if (previousGuard && previousGuard.expectedRevision !== guard.expectedRevision) throw guidanceError(new Error('Conflicting story source revision guards'), 'guid-253f2d40f9d9fc4f');
      byPath.set(key, guard);
    }
    const uniqueGuards = [...byPath.values()].filter(g => g.path !== path);
    const write = { path, content, frontmatter, expectedRevision: String(expectedRevision) };
    const saved = await withStoryWrite(path, () => uniqueGuards.length
      ? this.fs.writeNoteWithRevisionGuardsAndReceipt(write, uniqueGuards, { maxGuards: 128, assertAccess })
      : this.fs.writeNoteWithReceipt(write, { assertAccess }));
    return { ...result, revision: saved.revision };
  }

  async assertCurrent(guards: StoryGuard[], principal?: ScopePrincipal): Promise<void> {
    for (const guard of new Map(guards.map(item => [item.path, item])).values()) {
      if (!this.access.canAccessPhysicalPath(guard.path, principal) || await this.fs.readNoteRevision(guard.path, 512000) !== guard.expectedRevision) throw guidanceError(new Error('Story sources changed during read; refresh context'), 'guid-9809f474f3c0a933');
    }
  }
}
