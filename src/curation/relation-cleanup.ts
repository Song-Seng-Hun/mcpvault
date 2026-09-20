import { RELATION_FIELDS } from '../graph-contract.js';
import { compilationPath, wikiKnowledgeOutput } from '../compilation-policy.js';
import { isModerationHidden } from '../moderation-policy.js';
import type { FileSystemService } from '../filesystem.js';
import type { ScopeAccessPolicy } from '../scope-access.js';
import type { ScopePrincipal } from '../scope-auth.js';
import type { ParsedNote } from '../types.js';
import { unavailable } from '../evolution/policy.js';

/** Remove exact duplicate occurrences only. No target resolution, alias folding,
 * reciprocal edge inference or changes to relation evidence/rationale. */
export function relationCleanup(note: Pick<ParsedNote, 'frontmatter' | 'revision'>, path: string) {
  const set: Record<string, string[]> = {}; let removed = 0, inspected = 0;
  for (const relation of RELATION_FIELDS) {
    const values = note.frontmatter[relation]; if (values === undefined) continue;
    if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) continue;
    inspected += values.length;
    if (inspected > 200) return { status: 'review_required' as const, partial: true, reason: 'relation_budget_exceeded' };
    const unique = [...new Set<string>(values)];
    if (unique.length !== values.length) { set[relation] = unique; removed += values.length - unique.length; }
  }
  return { status: 'ready' as const, removed,
    changes: [{ path, expectedRevision: note.revision, frontmatter: { set } }] };
}

/** Wiki-owner read-only intent. The curation journal must independently require
 * exact host grants, historical managed receipts and guarded change-set apply. */
export async function wikiRelationCleanup(fs: FileSystemService, access: ScopeAccessPolicy,
  principal: ScopePrincipal | undefined, path: string, expectedRevision: string) {
  if (!wikiKnowledgeOutput(compilationPath(path)) || !principal?.capabilities?.includes('publish')
    || !principal.capabilities.includes('write')) return unavailable();
  const visible = () => access.canAccessPhysicalPath(path, principal) && access.canReadProtectedDocument(path, principal);
  if (!visible()) return unavailable();
  access.assertMutationAllowed(path, 'wiki.relation_set');
  const note = await fs.readNote(path, 24000), fm = note.frontmatter;
  const flag = (v: unknown) => v !== undefined && v !== false && String(v).trim().toLowerCase() !== 'false';
  if (!visible() || note.revision !== expectedRevision || fm.llm_wiki_type !== 'knowledge' || isModerationHidden(fm)
    || flag(fm.immutable) || flag(fm.source_only) || flag(fm.legal_hold) || fm.processing_mode === 'source_only'
    || String(fm.retention_policy ?? '').trim().toLowerCase() === 'preserve'
    || fm.preserve_until !== undefined && (!Number.isFinite(Date.parse(String(fm.preserve_until)))
      || Date.parse(String(fm.preserve_until)) > Date.now())) return unavailable();
  return relationCleanup(note, path);
}
