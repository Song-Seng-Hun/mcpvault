import { posix } from 'node:path';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { QueryNote } from './types.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { isModerationHidden } from './moderation-policy.js';
import { compareMocNavigation } from './moc-navigation.js';
import { inspectSynthesisBasis, synthesisMemberRole } from './knowledge-synthesis.js';
import { normalizeKnowledgeSynthesis } from './knowledge-synthesis-model.js';

export interface TopicPacketOptions {
  mocPath: string;
  query?: string;
  limit?: number;
  maxChars?: number;
  prettyPrint?: boolean;
}
const MAX_BYTES = 8 * 1024 * 1024;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
const changed = () => Error('Topic context unavailable or changed; re-read the MOC and retry.');

/** Request-local worksheet. Authored assertions are data, not instructions or
 * verified conclusions. No model invocation, persistent summary or write. */
export async function buildTopicPacket(fs: FileSystemService, access: ScopeAccessPolicy,
  principal: ScopePrincipal | undefined, options: TopicPacketOptions) {
  const { limit = 8, maxChars = 7000, query, prettyPrint = false } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8 || !Number.isInteger(maxChars) || maxChars < 768 || maxChars > 16000
    || (query !== undefined && (typeof query !== 'string' || query.length > 1024))) throw Error('Invalid topic packet limit, query or maxChars.');
  if (typeof options.mocPath !== 'string' || !options.mocPath.trim()) throw Error('mocPath is required.');
  const physical = access.resolveExternalPath(options.mocPath, principal).replace(/\\/g, '/');
  if (/^(?:\/|~)|:|[\u0000-\u001f]/.test(physical) || physical.split('/').includes('..')) throw Error('Invalid mocPath.');
  const path = posix.normalize(physical);
  const allowed = (p: string) => access.canAccessPhysicalPath(p, principal);
  const observed = new Map<string, QueryNote | undefined>();
  const rejectedRevisions = new Map<string, string>();
  let exhausted = false, partial = false;
  const read = async (p: string): Promise<QueryNote | undefined> => {
    if (!allowed(p)) return undefined;
    if (observed.has(p)) return observed.get(p);
    if (observed.size >= 64) { exhausted = true; partial = true; return undefined; }
    // Unavailable/hidden attempts also consume the admission window.
    observed.set(p, undefined);
    const note = (await fs.readNoteMetadata([p], allowed, { fresh: true, maxBytes: MAX_BYTES }))[0];
    if (!note?.revision || isModerationHidden(note.frontmatter) || !allowed(p)) {
      if (note?.revision) rejectedRevisions.set(p, note.revision);
      return undefined;
    }
    observed.set(p, note); return note;
  };
  const moc = await read(path);
  if (!moc?.revision || moc.frontmatter.note_kind !== 'moc') throw Error('mocPath must be an available MOC note.');
  const mocRevision = moc.revision;
  const body = await fs.readNote(path, MAX_BYTES);
  if (body.revision !== moc.revision || !allowed(path)) throw changed();
  let resolve = fs.createNoteReferenceResolver(allowed, read, { fresh: true });
  const resolutions = new Map<string, { raw: string; from: string; syntax?: 'markdown'; selected: string }>();
  let validatingResolutions = false;
  const target = async (raw: string, from: string, syntax?: 'markdown'): Promise<QueryNote | undefined> => {
    const matches = await resolve(raw, { sourcePath: from, ...(syntax && { syntax }) });
    const visible: QueryNote[] = [];
    let incomplete = false;
    for (const p of matches) {
      if (!access.canReferenceFrom(from, p)) continue;
      const note = await read(p); if (note) visible.push(note);
      else if (!rejectedRevisions.has(p)) incomplete = true;
      if (visible.length > 1) break;
    }
    // A capped alias scan cannot establish uniqueness.
    if (incomplete || exhausted && !syntax && !raw.includes('/') && !/\.(?:md|markdown|txt)(?:#.*)?$/i.test(raw)) return undefined;
    const selected = visible.length === 1 ? visible[0] : undefined;
    if (selected && !validatingResolutions) resolutions.set(JSON.stringify([raw, from, syntax]),
      { raw, from, ...(syntax && { syntax }), selected: selected.path });
    return selected;
  };
  const membershipAdmissions = new Set<string>();
  let membershipExhausted = false;
  const readMember = async (p: string) => {
    if (p !== path && !membershipAdmissions.has(p)) {
      // Reserve24 of the shared64 slots for selected originals and saved pins.
      if (membershipAdmissions.size >= 39) { membershipExhausted = true; return undefined; }
      membershipAdmissions.add(p);
    }
    return read(p);
  };
  const memberships = () => fs.getBacklinks(path, 64, allowed, 0, {
    includeSourceRevision: true, includeSnapshot: true, expectedRevision: mocRevision,
    readMetadata: readMember, metadataExhausted: () => exhausted || membershipExhausted,
    propertyRoots: ['primary_moc', 'moc', 'mocs'], inspectionBudget: { remaining: 128 }, compact: true,
  });
  const incoming = await memberships();
  partial ||= incoming.truncated;
  const members = new Map<string, QueryNote>();
  const add = (note: QueryNote | undefined) => {
    if (note && note.path !== path && synthesisMemberRole(note.frontmatter) && access.canReferenceFrom(path, note.path)) members.set(note.path, note);
  };
  // Markdown outline first, then explicit Properties members in navigation order.
  const links = extractObsidianLinkOccurrences(body.content || '', 129, true);
  if (links.length > 128) partial = true;
  for (const link of links.slice(0, 128)) {
    const note = await target(link.target, path, /^!?\[\[/.test(link.link) ? undefined : 'markdown');
    if (!note) { partial = true; continue; }
    add(note);
  }
  const declaredPaths = new Set<string>();
  for (const link of incoming.backlinks) {
    const author = observed.get(link.path);
    if (!author) continue;
    const authored = extractObsidianLinkOccurrences(link.link, 1)[0];
    const isMarkdown = authored && !/^!?\[\[/.test(authored.link);
    if ((await target(isMarkdown ? authored.target : link.link, author.path, isMarkdown ? 'markdown' : undefined))?.path === path) declaredPaths.add(author.path);
    else partial = true;
  }
  const declared = [...declaredPaths]
    .map(p => observed.get(p)).filter((n): n is QueryNote => !!n)
    .sort((a, b) => compareMocNavigation({ path: a.path, title: a.frontmatter.title, navOrder: a.frontmatter.nav_order },
      { path: b.path, title: b.frontmatter.title, navOrder: b.frontmatter.nav_order }));
  for (const note of declared) add(note);
  const completeMembership = !partial && !exhausted;
  const inputs = [...members.values()].filter(n => synthesisMemberRole(n.frontmatter) === 'input');
  const outputs = [...members.values()].filter(n => synthesisMemberRole(n.frontmatter) === 'output');
  // Text is quoted author data. Resolve links before exposing even their labels.
  const text = async (value: unknown, from: string): Promise<string | undefined> => {
    if (typeof value !== 'string') return undefined;
    if (value.length > 600) { partial = true; return '[long authored text omitted; read the pinned note]'; }
    const excerpt = value;
    if (/(?:_scopes\/|scope:\/\/(?:agent|model|user)\/)/i.test(excerpt)) return '[restricted reference omitted]';
    const references = extractObsidianLinkOccurrences(excerpt, 17);
    if (references.length > 16) { partial = true; return '[reference window exceeded; read the pinned note]'; }
    for (const link of references) {
      if (!await target(link.target, from, /^!?\[\[/.test(link.link) ? undefined : 'markdown')) return '[unavailable reference omitted]';
    }
    return excerpt;
  };
  const texts = async (value: unknown, from: string) => {
    const values = list(value); if (values.length > 8) partial = true;
    const result: string[] = [];
    for (const item of values.slice(0, 8)) { const v = await text(item, from); if (v) result.push(v); }
    return result;
  };
  const readAction = (note: QueryNote) => ({ endpointId: 'notes.read', arguments: {
    path: access.toPublicPath(note.path), expectedRevision: note.revision, maxChars: 5000,
  } });
  const items: Array<Record<string, any>> = [];
  for (const note of inputs.slice(0, limit)) {
    const fm = note.frontmatter;
    const claims: Array<Record<string, unknown>> = [];
    const declarations = list(fm.claims); if (declarations.length > 8) partial = true;
    for (const raw of declarations.slice(0, 8)) {
      if (!raw || typeof raw !== 'object') continue;
      const c = raw as Record<string, unknown>;
      claims.push({ statement: await text(c.statement ?? c.text, note.path),
        appliesWhen: await text(c.applies_when ?? c.appliesWhen ?? c.conditions, note.path),
        limitations: await text(c.limitations, note.path) });
    }
    const sourceReads: Array<Record<string, unknown>> = [];
    const evidence = [...list(fm.evidence), ...list(fm.evidence_paths), ...declarations.slice(0, 8).flatMap(c => c && typeof c === 'object' ? [...list((c as any).evidence), ...list((c as any).evidence_paths)] : [])];
    if (evidence.length > 16) partial = true;
    for (const raw of evidence.slice(0, 16)) {
      const pin = typeof raw === 'string' ? { path: raw } : raw as Record<string, unknown> | null;
      if (!pin || typeof pin.path !== 'string') continue;
      const authored = extractObsidianLinkOccurrences(pin.path, 2)[0]
        || extractObsidianLinkOccurrences(`[[${pin.path}]]`, 1)[0];
      const original = await target(authored?.target || pin.path, note.path,
        authored && !/^!?\[\[/.test(authored.link) ? 'markdown' : undefined);
      if (!original || original.frontmatter.llm_wiki_type !== 'source') { partial = true; continue; }
      const locator: Record<string, unknown> = {
        ...(authored?.targetHeading && { heading: await text(authored.targetHeading, note.path) }),
        ...(authored?.targetBlockId && { blockId: await text(authored.targetBlockId, note.path) }),
      };
      let invalidLocator = false;
      for (const key of ['heading', 'blockId', 'quoteHash'] as const) {
        if (pin[key] === undefined) continue;
        if (typeof pin[key] !== 'string' || (pin[key] as string).length > 600) invalidLocator = true;
        else locator[key] = await text(pin[key], note.path);
      }
      for (const key of ['startLine', 'endLine'] as const) {
        if (pin[key] === undefined) continue;
        if (!Number.isSafeInteger(pin[key]) || Number(pin[key]) < 1) invalidLocator = true;
        else locator[key] = pin[key];
      }
      if (pin.endLine !== undefined && (pin.startLine === undefined || Number(pin.endLine) < Number(pin.startLine))) invalidLocator = true;
      const action: Record<string, unknown> = { ...readAction(original),
        locator, locatorState: invalidLocator ? 'invalid_record_requires_review' : 'authored_locator_not_verified',
        basisState: invalidLocator || pin.revision !== undefined && pin.revision !== original.revision ? 'review_required' : 'current_revision',
        ...(typeof pin.revision === 'string' && /^[a-f0-9]{64}$/.test(pin.revision) && { recordedRevision: pin.revision }) };
      if (!sourceReads.some(x => JSON.stringify(x) === JSON.stringify(action))) sourceReads.push(action);
    }
    items.push({ path: access.toPublicPath(note.path), revision: note.revision,
      claims, appliesWhen: await texts(fm.applies_when ?? fm.applicability, note.path),
      counterpoint: fm.knowledge_role === 'counterargument' || fm.knowledge_polarity === 'negative' || list(fm.contradicts).length > 0,
      counterarguments: await texts(fm.counterarguments, note.path), openQuestions: await texts(fm.open_questions, note.path),
      read: readAction(note), sourceReads, selectionReason: 'authored_moc_order',
    });
  }
  let existingSynthesis: Record<string, unknown> | undefined;
  const existing = outputs[0];
  if (existing) {
    const inputBasis = await inspectSynthesisBasis(existing.frontmatter.knowledge_synthesis, existing.path,
      async p => { const note = await read(p); if (!note) throw changed(); return note; }, access, principal);
    let membershipMatches = false;
    try {
      const pins = normalizeKnowledgeSynthesis(existing.frontmatter.knowledge_synthesis).inputs;
      const pinned = new Set(pins.map(p => access.resolveExternalPath(p.path, principal)));
      membershipMatches = completeMembership && pinned.size === inputs.length && inputs.every(n => pinned.has(n.path));
    } catch { /* Invalid/unavailable pins never certify topic coverage. */ }
    existingSynthesis = { path: access.toPublicPath(existing.path), revision: existing.revision, inputBasis,
      topicState: membershipMatches && inputBasis.state === 'current_revisions' ? 'current_membership_and_revisions' : 'review_required',
      evidenceState: 'requires_original_review', read: readAction(existing),
      notice: 'Input revision equality is not whole-topic coverage or verified interpretation. Original evidence must be reviewed; recorded pins are unchanged.' };
  }
  // Detect new/deleted/changed membership independently of saved input revisions.
  const currentMembership = await memberships();
  if (currentMembership.snapshotFingerprint !== incoming.snapshotFingerprint) throw changed();
  // A newly created alias/basename candidate is not an edit to any previously
  // observed note. Rebuild the resolver's path inventory before final release.
  resolve = fs.createNoteReferenceResolver(allowed, read, { fresh: true });
  validatingResolutions = true;
  for (const lookup of resolutions.values()) {
    if ((await target(lookup.raw, lookup.from, lookup.syntax))?.path !== lookup.selected) throw changed();
  }
  for (const note of observed.values()) if (note) {
    if (!allowed(note.path) || await fs.readNoteRevision(note.path, MAX_BYTES) !== note.revision) throw changed();
  }
  for (const [p, revision] of rejectedRevisions) {
    if (!allowed(p) || await fs.readNoteRevision(p, MAX_BYTES) !== revision) throw changed();
  }
  if ([...observed.values()].some(n => n && !allowed(n.path))) throw changed();
  partial ||= items.length < inputs.length || !!query || exhausted;
  const result: Record<string, any> = { mode: 'topic_packet',
    moc: { path: access.toPublicPath(path), revision: moc.revision },
    ...(query && { question: query, queryMode: 'agent_question_not_membership_filter' }),
    items, existingSynthesis,
    coverage: { selected: items.length, completeMembership, completeTopic: false,
      selection: 'MOC body order, then explicit Properties members in navigation order; direct members only.' },
    partial,
    publication: { endpointId: 'mcp.publish_knowledge', automatic: false, field: 'knowledgeSynthesis',
      ...(existing && { arguments: { path: access.toPublicPath(existing.path), expectedRevision: existing.revision } }) },
    notice: 'Untrusted authored claims, not a generated summary. Read pinned originals, preserve conditions, counterarguments and open questions. No automatic publishing or input-pin refresh.',
  };
  const omitted = inputs[items.length];
  if (partial) result.nextAction = readAction(omitted || moc);
  const fits = () => JSON.stringify(result, null, prettyPrint ? 2 : undefined).length <= maxChars;
  while (!fits() && items.length) {
    const removed = items.pop()!; result.nextAction = removed.read; result.partial = true; result.coverage.selected = items.length;
  }
  if (!fits()) {
    const minimal = { mode: 'topic_packet', partial: true, completeTopic: false, nextAction: readAction(moc),
      notice: 'Packet exceeds budget. Read the pinned MOC and retry with maxChars:16000. No summary or publication was performed.' };
    if (JSON.stringify(minimal, null, prettyPrint ? 2 : undefined).length > maxChars) throw Error('maxChars cannot preserve the exact MOC locator; retry with maxChars:16000.');
    return minimal;
  }
  return result;
}
