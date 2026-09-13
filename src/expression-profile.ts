import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';

// Code-owned guidance. Public source text remains untrusted reference data.
const CHAPTERS = [
  {
    "id": "language",
    "title": "Dense English and bilingual names",
    "description": "Use for new Vault explanations and verified bilingual identifiers.",
    "avoid": "Exact evidence, source_only bodies, code, errors and real quotations.",
    "previous": "SKILL.md",
    "next": "precision.md",
    "keywords": [
      "English",
      "한국어",
      "names",
      "translation"
    ],
    "rules": [
      "Write concise grammatical English. Keep one instruction or fact per sentence.",
      "Keep technical terms consistent. Remove rhetoric and repetition, not meaning.",
      "Preserve negation, exceptions, conditions, causes, uncertainty, numbers and units.",
      "Use English (한국어) at first relevant name use in each independent chapter.",
      "For Korean interface instructions, use 한국어 (English).",
      "Use a verified English name only. Otherwise retain the original Korean name.",
      "Bind aliases to entity ID, project, version and language; never merge by label.",
      "Keep the original query and verified Korean aliases available to search.",
      "Translation and original remain one source family, not independent evidence.",
      "Do not translate source_only bodies. Preserve exact reads and exports.",
      "Compression cannot change tool IDs, arguments, enums, errors or validation.",
      "Use full sentences for security warnings and irreversible procedures."
    ],
    "example": "Example: Open 설정 (Settings). Do not reset the world unless its owner approves.",
    "counter": "Counterexample: 'Backup safe' must not replace 'Backup may be incomplete.'"
  },
  {
    "id": "precision",
    "title": "Meaning and evidence preservation",
    "description": "Use before accepting compressed or translated guidance.",
    "avoid": "Treating a shorter result, string match or read receipt as proof of understanding.",
    "previous": "language.md",
    "next": "fiction.md",
    "keywords": [
      "fidelity",
      "conditions",
      "원문",
      "review"
    ],
    "rules": [
      "Preserve original bytes, revisions, exact locators and access restrictions.",
      "Keep evidence separate from the English body and its discovery card.",
      "Never compress quotations, actual speech, code, commands, errors or licenses.",
      "Protect only/except/unless/not, quantities, units, alternatives and failure cases.",
      "Do not invent abbreviations, resolved uncertainty or a user's decision reason.",
      "A chapter must remain understandable without loading every adjacent chapter.",
      "Use matching source and output locations for mechanical checks.",
      "Record semantic review separately; literal checks do not prove translation.",
      "Keep unverified transformations as candidates; retain the current original.",
      "If required context does not fit, return partial with an exact further read.",
      "Retain required progress updates and honest limitations; no silent long-running work.",
      "Style never grants access, overrides absolute rules or authorizes execution."
    ],
    "example": "Example: 'Retry once if offline; never replay an uncertain write.' Keep both clauses.",
    "counter": "Counterexample: 'Retry writes' deletes the precondition and prohibition."
  },
  {
    "id": "fiction",
    "title": "Expression without character mutation",
    "description": "Use for system guidance around character and scene workflows.",
    "avoid": "Rewriting character identity, memory, actual speech, world state or scene language.",
    "previous": "precision.md",
    "next": "SKILL.md",
    "keywords": [
      "roleplay",
      "persona",
      "scene",
      "캐릭터"
    ],
    "rules": [
      "Apply the dense English profile to new system explanations, not canonical characters.",
      "Existing character identity, definitions, memories and actual utterances stay unchanged.",
      "Explicit scene language and direct quotations take precedence over this style default.",
      "Preserve Korean UI labels and names needed to identify the same in-world target.",
      "Do not change state, beliefs, actions, permissions or existing dialogue to fit style.",
      "Use roleplay.context for currently accessible character context.",
      "Use revision-checked owner services for authorized changes; this profile grants none.",
      "Fiction and character beliefs are not evidence about the real world.",
      "A style profile is not a new actor, personality, administrator or model.",
      "No offline turns, automatic model wakeups or background dialogue are implied."
    ],
    "example": "Example: A Korean scene keeps '문을 열지 마.' System help may say 'Read the current turn.'",
    "counter": "Counterexample: Translating a stored quote in place changes the event; do not do it."
  }
] as const;

export const EXPRESSION_CHAPTERS = ['language', 'precision', 'fiction'] as const;
export const EXPRESSION_PROFILE_ID = 'vault-dense-english';
export function expressionChapter(id: string): string {
  const chapter = CHAPTERS.find(c => c.id === id);
  if (!chapter) throw guidanceError(new Error('Expression profile unavailable'), 'guid-9e8a7e4caecfc920');
  const lines = ['---', `id: vault-dense-english-${chapter.id}`, 'kind: expression-guide',
    `description: ${chapter.description}`, 'domain: context-authoring', 'stage: author-review',
    `keywords: ${JSON.stringify(chapter.keywords)}`, 'language: en', 'parent: SKILL.md',
    `previous: ${chapter.previous}`, `next: ${chapter.next}`, `position: ${CHAPTERS.indexOf(chapter) + 1}/3`,
    'authority: style-only', 'rule_version: 1', '---', `# ${chapter.title}`, '',
    `Use: ${chapter.description}`, `Avoid: ${chapter.avoid}`, '',
    ...chapter.rules.map(rule => `- ${rule}`), '', chapter.example, chapter.counter, ''];
  return lines.join('\n');
}
export const EXPRESSION_REVISION = createHash('sha256').update(JSON.stringify(EXPRESSION_CHAPTERS.map(expressionChapter))).digest('hex');
export function expressionReference() {
  return { profileId: EXPRESSION_PROFILE_ID, executionAuthority: false,
    readAction: { endpointId: 'wiki.policy', arguments: { topic: 'expression', expectedProfileRevision: EXPRESSION_REVISION, maxChars: 4000 } } };
}
export interface ExpressionPolicyOptions {
  chapter?: unknown; expectedProfileRevision?: unknown; maxChars?: unknown; prettyPrint?: unknown;
}
export function expressionPolicy(options: ExpressionPolicyOptions = {}, envelope: Record<string, unknown> = {}): Record<string, any> {
  if (options.chapter !== undefined && (typeof options.chapter !== 'string' || !(EXPRESSION_CHAPTERS as readonly string[]).includes(options.chapter))
    || options.expectedProfileRevision !== undefined && options.expectedProfileRevision !== EXPRESSION_REVISION) {
    throw guidanceError(new Error('Expression profile unavailable'), 'guid-9e8a7e4caecfc920');
  }
  const maxChars = options.maxChars === undefined ? 4000 : options.maxChars;
  if (!Number.isInteger(maxChars) || (maxChars as number) < 512 || (maxChars as number) > 16000
    || options.prettyPrint !== undefined && typeof options.prettyPrint !== 'boolean') throw guidanceError(new Error('Expression profile unavailable'), 'guid-9e8a7e4caecfc920');
  const chapter = options.chapter as string | undefined;
  const result: Record<string, any> = { ...envelope, profileId: EXPRESSION_PROFILE_ID, profileRevision: EXPRESSION_REVISION,
    executionAuthority: false, partial: false };
  if (chapter) {
    result.body = expressionChapter(chapter);
    const index = (EXPRESSION_CHAPTERS as readonly string[]).indexOf(chapter);
    const action = (id?: string) => ({ endpointId: 'wiki.policy', arguments: { topic: 'expression',
      ...(id && { chapter: id }), expectedProfileRevision: EXPRESSION_REVISION, maxChars: 4000 } });
    result.navigation = { parent: action(), previous: action(EXPRESSION_CHAPTERS[index - 1]), next: action(EXPRESSION_CHAPTERS[index + 1]) };
  }
  else result.items = CHAPTERS.map(c => ({ id: c.id, description: c.description,
    readAction: { endpointId: 'wiki.policy', arguments: { topic: 'expression', chapter: c.id,
      expectedProfileRevision: EXPRESSION_REVISION, maxChars: 4000 } } }));
  if (JSON.stringify(result, null, options.prettyPrint ? 2 : undefined).length <= (maxChars as number)) return result;
  // No partial body was returned, so the continuation can start a fresh read.
  // Avoid repeating two 64-byte fingerprints in the minimum-size envelope.
  return { ...envelope, partial: true, truncated: true,
    nextAction: { endpointId: 'wiki.policy', arguments: { topic: 'expression', ...(chapter && { chapter }),
      maxChars: 4000 } } };
}
