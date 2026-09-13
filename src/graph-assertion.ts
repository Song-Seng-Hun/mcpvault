import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { extractObsidianLinkOccurrences } from './backlinks.js';
import { CLAIM_RELATION_FIELDS, GRAPH_CONTRACT_VERSION, RELATION_FIELDS } from './graph-contract.js';
import { claimId } from './graph-validation.js';

export type AssertionLocator = { basis: 'properties'; propertyPath: string }
  | { basis: 'markdown_body'; line: number; occurrence: number }
  | { basis: 'graphify_result'; occurrence: number; sourceLocation?: string };
export interface GraphAssertion {
  id: string;
  source: { repositoryId: string; documentId: string; versionId: string; path: string; revision: string;
    identityBasis: 'repository_path_not_rename_stable'; claimId?: string; symbolId?: string };
  relation: string;
  direction: 'source_to_target';
  targetReference: string;
  /** Present only after a host adapter has resolved and revalidated the target.
   * Still private; not a substitute for a public endpoint's ACL boundary. */
  target?: { documentId: string; versionId: string; path: string; revision: string; symbolId?: string };
  syntax?: 'markdown';
  locator: AssertionLocator;
  kind: 'authored' | 'extracted' | 'inferred';
  extraction: { method: 'properties' | 'obsidian_links' | 'graphify_result'; version: number };
  evidenceState: 'not_verified';
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const values = (value: unknown): unknown[] => Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];

/** Private candidate extraction, NOT an ACL boundary. Never serialize candidates
 * until both endpoints have been uniquely resolved and revalidated by the caller.
 * Properties and body occurrences are separate; line coordinates exclude headers.
 * Identical occurrences remain separate even if a consumer uses a simple graph. */
export function extractGraphAssertions(input: { repositoryId: string; path: string; revision: string;
  frontmatter: Record<string, unknown>; content: string; limit?: number }) {
  const { repositoryId, path, revision, frontmatter, content, limit = 80 } = input;
  if (!repositoryId || repositoryId.length > 200 || !path || /^(?:\/|~)|\\|:|[\u0000-\u001f]/.test(path)
    || path.split('/').includes('..') || posix.normalize(path) !== path || !/^[a-f0-9]{64}$/i.test(revision)
    || !Number.isInteger(limit) || limit < 1 || limit > 80) throw Error('Invalid graph assertion basis or limit.');
  const documentId = digest([repositoryId, path]);
  const source = { repositoryId, documentId, versionId: digest([documentId, revision]), path, revision,
    identityBasis: 'repository_path_not_rename_stable' as const };
  const assertions: GraphAssertion[] = [];
  let partial = false, inspected = 0;
  const add = (target: unknown, relation: string, locator: AssertionLocator, claimId?: string, syntax?: 'markdown') => {
    if (++inspected > limit) { partial = true; return; }
    if (typeof target !== 'string' || !target.trim() || target.length > 1024) { partial = true; return; }
    const itemSource = { ...source, ...(claimId && { claimId }) };
    const targetReference = target.trim();
    assertions.push({ id: digest([itemSource.versionId, claimId, relation, targetReference, locator]), source: itemSource,
      relation, direction: 'source_to_target', targetReference, ...(syntax && { syntax }), locator,
      kind: locator.basis === 'properties' ? 'authored' : 'extracted',
      extraction: { method: locator.basis === 'properties' ? 'properties' : 'obsidian_links', version: GRAPH_CONTRACT_VERSION },
      evidenceState: 'not_verified' });
  };
  const property = (raw: unknown, name: string, relation: string, claimId?: string) => {
    const entries = values(raw);
    for (let i = 0; i < entries.length; i++) {
      if (inspected >= limit) { partial = true; break; }
      add(entries[i], relation, { basis: 'properties', propertyPath: Array.isArray(raw) ? `${name}[${i}]` : name }, claimId);
    }
  };
  for (const relation of RELATION_FIELDS) property(frontmatter[relation], relation, relation);
  property(frontmatter.evidence_paths, 'evidence_paths', 'evidence');
  const claims = Array.isArray(frontmatter.claims) ? frontmatter.claims : [];
  // Empty/malformed claims also consume a bounded inspection window.
  if (claims.length > 80) partial = true;
  for (let i = 0; i < Math.min(80, claims.length); i++) {
    const claim = claims[i];
    if (!claim || typeof claim !== 'object') { partial = true; continue; }
    const id = claimId(typeof claim.id === 'string' ? claim.id : undefined, i);
    for (const { property: field, relation } of CLAIM_RELATION_FIELDS) property(claim[field], `claims[${i}].${field}`, relation, id);
    property(claim.evidence_paths, `claims[${i}].evidence_paths`, 'evidence', id);
  }
  let previousLine = 0, occurrence = 0;
  for (const link of extractObsidianLinkOccurrences(content, limit - inspected + 1, true)) {
    if (link.line !== previousLine) { occurrence = 0; previousLine = link.line; }
    // Keep the original spelling and anchor; do not pretend resolution occurred.
    add(link.link, 'link', { basis: 'markdown_body', line: link.line, occurrence: occurrence++ }, undefined,
      /^!?\[\[/.test(link.link) ? undefined : 'markdown');
  }
  return { assertions, partial };
}

/** Lossy discovery-only projection; raw occurrence records remain untouched.
 * No weights, confidence, evidence independence or permission propagation. */
export function projectAssertionPairs(assertions: readonly GraphAssertion[]) {
  const pairs = new Map<string, { source: string; targetReference: string }>();
  for (const assertion of assertions) {
    const pair = { source: assertion.source.documentId, targetReference: assertion.targetReference };
    pairs.set(JSON.stringify(pair), pair);
  }
  return [...pairs.values()];
}
