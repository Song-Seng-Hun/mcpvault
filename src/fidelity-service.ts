import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { resolveEvidenceLocator, type EvidenceLocator } from './evidence-locator.js';
import { createHash } from 'node:crypto';
import { compilationId, isCompilationRevision } from './compilation-model.js';
import { compilationPath } from './compilation-policy.js';
import { isModerationHidden } from './moderation-policy.js';
import { checkFidelityPreservation } from './fidelity-literals.js';
import { bodyStartLine, passageAction } from './retrieval-service.js';

export interface FidelityFact {
  id: string; kind: 'condition' | 'negation' | 'counterexample' | 'contradiction' | 'number' | 'date' | 'version' | 'quote';
  sourceLocator: EvidenceLocator; outputLocator?: EvidenceLocator;
  comparisonMode: 'exact' | 'translation' | 'calculation' | 'ambiguous_unit';
  semanticJudgment: 'preserved' | 'missing' | 'uncertain';
}
export interface FidelityCheckParams {
  sourcePath: string; outputPath: string; sourceRevision: string; outputRevision: string;
  facts: FidelityFact[]; maxChars?: number; principal?: ScopePrincipal;
}
export class FidelityService {
  constructor(private readonly fs: FileSystemService, private readonly access: ScopeAccessPolicy) {}
  /** Read-only, bounded comparison. Agent reports are attributed, never upgraded
   * to server-certified semantic truth or a grant to publish derived content. */
  async check(params: FidelityCheckParams, assertCurrent: () => Promise<void> = async () => {}): Promise<any> {
    const unavailable = () => Error('Fidelity input unavailable or changed');
    try {
      const budget = params.maxChars ?? 4000;
      if (!Number.isSafeInteger(budget) || budget < 512 || budget > 12000
        || !isCompilationRevision(params.sourceRevision) || !isCompilationRevision(params.outputRevision)
        || !Array.isArray(params.facts) || !params.facts.length || params.facts.length > 32) throw unavailable();
      const ids = new Set<string>();
      for (const fact of params.facts) {
        if (!fact || !compilationId(fact.id) || ids.has(fact.id)
          || !['condition', 'negation', 'counterexample', 'contradiction', 'number', 'date', 'version', 'quote'].includes(fact.kind)
          || !['exact', 'translation', 'calculation', 'ambiguous_unit'].includes(fact.comparisonMode)
          || !['preserved', 'missing', 'uncertain'].includes(fact.semanticJudgment) || !fact.sourceLocator) throw unavailable();
        ids.add(fact.id);
      }
      await assertCurrent();
      const physical = (path: string) => compilationPath(typeof path === 'string' && path.startsWith('scope://')
        ? this.access.resolveExternalPath(path, params.principal) : path);
      const sourcePath = physical(params.sourcePath), outputPath = physical(params.outputPath);
      const canAccess = (path: string) => this.access.canAccessPhysicalPath(path, params.principal);
      const load = async (path: string, revision: string) => {
        if (!canAccess(path)) throw unavailable();
        const metadata = (await this.fs.readNoteMetadata([path], canAccess, { fresh: true, strict: true, maxBytes: 512 * 1024 }))[0];
        if (!metadata || metadata.revision !== revision || isModerationHidden(metadata.frontmatter) || !canAccess(path)) throw unavailable();
        const note = await this.fs.readNote(path, 512 * 1024);
        if (note.revision !== revision || isModerationHidden(note.frontmatter) || !canAccess(path)) throw unavailable();
        return note;
      };
      const source = await load(sourcePath, params.sourceRevision);
      if (source.frontmatter.llm_wiki_type !== 'source' || source.frontmatter.immutable !== true
        || source.frontmatter.content_sha256 !== createHash('sha256').update(source.content).digest('hex')) throw unavailable();
      const output = await load(outputPath, params.outputRevision);
      const checks = params.facts.map(fact => {
        const preservation = checkFidelityPreservation({ source: { body: source.content, revision: source.revision },
          output: { body: output.content, revision: output.revision }, sourceLocator: fact.sourceLocator,
          outputLocator: fact.outputLocator, comparisonMode: fact.comparisonMode }, fact.kind);
        return { id: fact.id, kind: fact.kind, literalStatus: preservation.literal.status, literalKinds: preservation.literal.kinds,
          verbatimStatus: preservation.verbatim, preservation: !preservation.preserved ? 'incomplete'
            : preservation.verbatim === 'match' ? 'verified_verbatim' : 'literal_correspondence_only',
          semanticJudgment: { source: 'agent_report', judgment: fact.semanticJudgment } };
      });
      const incomplete = checks.findIndex(check => check.preservation === 'incomplete' || check.semanticJudgment.judgment !== 'preserved');
      const index = incomplete < 0 ? 0 : incomplete;
      const selected = params.facts[index]!.sourceLocator;
      // Body coordinates are translated only at the existing physical-line read boundary.
      // Never turn stale/client-supplied coordinates into a nonexistent read.
      const resolved = resolveEvidenceLocator(source.content, selected, source.revision);
      const validSpan = resolved.valid && resolved.startLine && resolved.endLine && resolved.endLine - resolved.startLine < 64;
      const start = bodyStartLine(source) + (validSpan ? resolved.startLine! : 1) - 1;
      const end = bodyStartLine(source) + (validSpan ? resolved.endLine! : 1) - 1;
      const response: Record<string, any> = { status: incomplete < 0 ? 'checked' : 'partial', automaticApplication: false,
        sourceRevision: source.revision, outputRevision: output.revision, checks,
        ...(incomplete >= 0 && { nextAction: passageAction(this.access.toPublicPath(sourcePath), source.revision, start, end) }) };
      while (JSON.stringify(response).length > budget && checks.length) {
        checks.pop(); response.status = 'partial'; response.reason = 'response_budget';
        response.nextAction ??= passageAction(this.access.toPublicPath(sourcePath), source.revision, start, end);
      }
      if (JSON.stringify(response).length > budget) { delete response.sourceRevision; delete response.outputRevision; }
      if (JSON.stringify(response).length > budget) throw unavailable();
      await assertCurrent();
      for (const [path, revision] of [[sourcePath, source.revision], [outputPath, output.revision]] as const) {
        if (!canAccess(path) || await this.fs.readNoteRevision(path, 512 * 1024) !== revision) throw unavailable();
      }
      if (!canAccess(sourcePath) || !canAccess(outputPath)) throw unavailable();
      return response;
    } catch { throw unavailable(); }
  }
}
