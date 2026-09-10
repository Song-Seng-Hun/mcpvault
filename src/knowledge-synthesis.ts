import { guidanceError } from './guidance-runtime.js';
import { posix } from 'node:path';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { isModerationHidden } from './moderation-policy.js';
import { ReferenceService } from './references.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { parseWikiLink } from './wikilink/resolveWikiLink.js';
import { normalizeKnowledgeSynthesis } from './knowledge-synthesis-model.js';
import type { QueryNote } from './types.js';

const BYTES = 8 * 1024 * 1024;
const UNAVAILABLE = 'Synthesis input unavailable or changed; read current context and retry';
const INPUT_KINDS = new Set(['atomic', 'knowledge', 'literature', 'question', 'hypothesis', 'experiment', 'assumption', 'decision']);
const historicalInput = (fm: Record<string, unknown>) => ['archived', 'superseded', 'tombstoned'].includes(String(fm.lifecycle || '').trim().toLowerCase())
  || ['disputed', 'superseded'].includes(String(fm.knowledge_status || '').trim().toLowerCase())
  || ['rejected', 'superseded'].includes(String(fm.decision_status || '').trim().toLowerCase());

/** Inspect only visible current metadata; never expose unavailable input identities. */
export async function inspectSynthesisBasis(value: unknown, container: string,
  read: (path: string) => Promise<QueryNote>, access: ScopeAccessPolicy, principal?: ScopePrincipal) {
  if (value === undefined) return { state: 'unrecorded' };
  let synthesis;
  try { synthesis = normalizeKnowledgeSynthesis(value); } catch { return { state: 'invalid_record' }; }
  const changedInputIds: string[] = [], historicalInputIds: string[] = [];
  for (const input of synthesis.inputs) {
    try {
      const path = input.path.startsWith('scope://') ? access.resolveExternalPath(input.path, principal) : input.path;
      if (!access.canAccessPhysicalPath(path, principal) || !access.canReferenceFrom(container, path)
        || (access.isCommunityPath(path) && !access.isCommunityPath(container) && !/^_scopes\//i.test(container))) return { state: 'inputs_unavailable' };
      const current = await read(path);
      if (current.frontmatter.llm_wiki_type !== 'knowledge') return { state: 'inputs_unavailable' };
      if (current.revision !== input.revision) changedInputIds.push(input.id);
      if (input.role === 'historical_context' || historicalInput(current.frontmatter)) historicalInputIds.push(input.id);
    } catch { return { state: 'inputs_unavailable' }; }
  }
  return { state: changedInputIds.length ? 'inputs_changed' : historicalInputIds.length ? 'review_required' : 'current_revisions',
    changedInputIds, historicalInputIds, notice: 'Current revisions do not verify the interpretation. Historical or disputed inputs are context, not current premises.' };
}

/** Validates a supplied interpretation for the existing publication transaction.
 * No separate writer, source promotion, truth score, or automatic input update. */
export async function prepareKnowledgeSynthesis(
  fs: FileSystemService, access: ScopeAccessPolicy, value: unknown, container: string, principal?: ScopePrincipal,
) {
  const synthesis = normalizeKnowledgeSynthesis(value);
  const physical = (value: string): string => {
    const expanded = value.startsWith('scope://') ? access.resolveExternalPath(value, principal) : value.replace(/\\/g, '/');
    if (posix.isAbsolute(expanded) || expanded.includes(':') || /[\u0000-\u001f\u007f]/.test(expanded)) throw Error(UNAVAILABLE);
    const path = posix.normalize(expanded);
    if (path === '..' || path.startsWith('../') || !access.canAccessPhysicalPath(path, principal)) throw Error(UNAVAILABLE);
    return path;
  };
  container = physical(container);
  const allowed = (path: string) => access.canAccessPhysicalPath(container, principal)
    && access.canAccessPhysicalPath(path, principal) && access.canReferenceFrom(container, path)
    && (!access.isCommunityPath(path) || access.isCommunityPath(container) || /^_scopes\//i.test(container));
  const guards = new Map<string, { path: string; expectedRevision: string }>();
  const inputIdentities = new Set<string>();
  const observe = async (path: string) => {
    if (!allowed(path) || path.toLowerCase() === container.toLowerCase()) throw Error(UNAVAILABLE);
    const key = path.toLowerCase();
    if (!guards.has(key) && guards.size >= 8) throw guidanceError(Error('Synthesis may reference at most eight distinct related notes, including prose links'), 'guid-95b66b165911313c');
    const meta = (await fs.readNoteMetadata([path], allowed, { fresh: true, strict: true, maxBytes: BYTES }))[0];
    if (!meta?.revision || isModerationHidden(meta.frontmatter)) throw Error(UNAVAILABLE);
    const old = guards.get(key);
    if (old && old.expectedRevision !== meta.revision) throw Error(UNAVAILABLE);
    guards.set(key, { path, expectedRevision: meta.revision });
    return meta;
  };
  for (const input of synthesis.inputs) {
    const path = physical(input.path), key = path.toLowerCase();
    if (inputIdentities.has(key)) throw guidanceError(Error('Duplicate synthesis input identity'), 'guid-3f4bf4f1fba39e6b');
    inputIdentities.add(key);
    const meta = await observe(path);
    if (meta.revision !== input.revision || meta.frontmatter.llm_wiki_type !== 'knowledge'
      || !INPUT_KINDS.has(String(meta.frontmatter.note_kind || 'knowledge'))) throw Error(UNAVAILABLE);
    if (historicalInput(meta.frontmatter) && input.role !== 'historical_context') throw guidanceError(Error('Retired or disputed synthesis input requires explicit historical_context role; preserve failed paths without treating them as current premises'), 'guid-fe25dc9e24292858');
    input.path = access.toPublicPath(path);
  }
  const fields = [synthesis.question, ...synthesis.explanations.flatMap(e => [e.explanation, e.appliesWhen, e.limitations]),
    ...synthesis.choices.flatMap(c => [c.when, c.reason]), ...synthesis.counterexamples.map(c => c.description), ...synthesis.unresolvedQuestions];
  const links = fields.flatMap(field => extractObsidianLinkOccurrences(field));
  if (links.length > 16) throw guidanceError(Error('Synthesis prose supports at most sixteen links; put long analysis in a linked note'), 'guid-92462cc3d797c2a0');
  const refs = new ReferenceService(fs, access);
  try {
    for (const link of links) {
      const raw = /^!?\[\[/.test(link.link) ? parseWikiLink(link.link.replace(/^!/, '')).document : link.target;
      const decoded = decodeURIComponent(raw).replace(/\\/g, '/');
      const path = decoded.startsWith('scope://') ? physical(decoded)
        : physical(decoded.startsWith('.') ? posix.join(posix.dirname(container), decoded) : decoded);
      if (!allowed(path)) throw Error(UNAVAILABLE);
    }
    for (const field of fields) for (const path of await refs.validateAndNormalize(undefined, container, principal, field, { strictBodyLinks: true })) await observe(path);
  } catch { throw Error(UNAVAILABLE); }
  const assertAccess = () => {
    if (!allowed(container) || [...guards.values()].some(g => !allowed(g.path))) throw Error(UNAVAILABLE);
  };
  assertAccess();
  return { synthesis, guards: [...guards.values()], assertAccess };
}
