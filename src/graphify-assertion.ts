import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { GraphAssertion } from './graph-assertion.js';
import { GRAPH_CONTRACT_VERSION } from './graph-contract.js';

export interface GraphifyAssertionHost {
  repositoryId: string;
  /** Explicit host allowlist/current permission, not a client supplied grant. */
  canRead(path: string): boolean;
  /** Re-read actual source bytes, validate local path/link safety, return SHA256.
   * Never return a cached or packet-supplied hash here. */
  readRevision(path: string): Promise<string>;
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const string = (v: unknown, max: number): v is string => typeof v === 'string' && !!v && v.length <= max;
const path = (v: unknown): v is string => string(v, 500) && posix.normalize(v) === v && !/^(?:\/|~)|[\\:\x00-\x1f<>"|?*]/.test(v)
  && v.split('/').every(p => p && p !== '..' && !p.startsWith('.') && !/[. ]$/.test(p)
    && !/^(?:dist|node_modules|credentials|secrets|host)$/i.test(p) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p));

/** Host-only adapter for the existing P3 bounded query result. It never runs an
 * AST extractor or reads a Vault. Private structural candidates, NOT MCP output
 * or claims of complete token occurrences, passing tests or verified evidence. */
export async function adaptGraphifyAssertions(input: unknown, host: GraphifyAssertionHost) {
  try {
    const p = input as any;
    if (!p || p.status !== 'current' || !sha(p.repositoryId) || p.repositoryId !== host.repositoryId
      || p.tool?.name !== 'graphifyy' || p.tool.version !== '0.9.58' || p.tool.adapterVersion !== 1
      || !Array.isArray(p.nodes) || p.nodes.length > 40 || !Array.isArray(p.edges) || p.edges.length > 80) throw Error();
    const nodes = new Map<string, { path: string; revision: string }>(), revisions = new Map<string, string>();
    for (const n of p.nodes) {
      if (!string(n?.id, 2048) || nodes.has(n.id) || !path(n.source_file) || !sha(n.sha256) || !host.canRead(n.source_file)) throw Error();
      if (revisions.has(n.source_file) && revisions.get(n.source_file) !== n.sha256) throw Error();
      nodes.set(n.id, { path: n.source_file, revision: n.sha256 }); revisions.set(n.source_file, n.sha256);
    }
    const verify = async () => {
      for (const [file, revision] of revisions) if (!host.canRead(file) || await host.readRevision(file) !== revision || !host.canRead(file)) throw Error();
      if ([...revisions.keys()].some(p => !host.canRead(p))) throw Error();
    };
    await verify();
    const assertions: GraphAssertion[] = [], occurrences = new Set<number>();
    for (const edge of p.edges) {
      const source = nodes.get(edge?.source), target = nodes.get(edge?.target);
      if (!source || !target || !string(edge.relation, 80) || !Number.isSafeInteger(edge.occurrenceId) || edge.occurrenceId < 0
        || occurrences.has(edge.occurrenceId) || edge.source_file !== source.path || edge.sourceHash !== source.revision
        || edge.source_location != null && !string(edge.source_location, 300)) throw Error();
      occurrences.add(edge.occurrenceId);
      const documentId = hash([p.repositoryId, source.path]), versionId = hash([documentId, source.revision]);
      const targetId = hash([p.repositoryId, target.path]);
      const locator: GraphAssertion['locator'] = { basis: 'graphify_result', occurrence: edge.occurrenceId,
        ...(edge.source_location && { sourceLocation: edge.source_location }) };
      assertions.push({ id: hash([versionId, edge.source, edge.target, target.revision, edge.relation, locator]),
        source: { repositoryId: p.repositoryId, path: source.path, revision: source.revision, documentId, versionId,
          symbolId: edge.source, identityBasis: 'repository_path_not_rename_stable' },
        relation: edge.relation, direction: 'source_to_target', targetReference: edge.target,
        target: { documentId: targetId, versionId: hash([targetId, target.revision]), path: target.path, revision: target.revision, symbolId: edge.target },
        locator, kind: 'extracted', extraction: { method: 'graphify_result', version: GRAPH_CONTRACT_VERSION }, evidenceState: 'not_verified' });
    }
    await verify();
    return { assertions, partial: true, testStatus: 'not_executed', tool: { name: 'graphifyy', version: '0.9.58', adapterVersion: 1 },
      notice: 'Host-private structural candidates; upstream may deduplicate identical payloads. Not a complete occurrence trace or a public ACL-safe view.' };
  } catch { throw Error('Graphify result unavailable or changed; rebuild the explicit host corpus.'); }
}
