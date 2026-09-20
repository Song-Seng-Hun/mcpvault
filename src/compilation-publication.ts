import { guidanceError } from './guidance-runtime.js';
import type { CompilationOptions } from './compilation-service.js';
import type { ScopePrincipal } from './scope-auth.js';
import { DocumentAuthority, documentPolicyPath } from './document-authority.js';
import { activeDocumentStorageContext, withPublicationStaging } from './enterprise-storage-context.js';
import { compilationHash, inspectCompilationPolicy, validateCompilationConfig } from './compilation-policy.js';
import { compilationContentHash, compilationId, isCompilationRevision } from './compilation-model.js';
import { bundleRecordId, parseCompilationBundle, parseBundleOriginal } from './compilation-bundle-model.js';
import { planVerbatimSplit } from './compilation-split-plan.js';
import { isDocumentBundleId } from './document-bundle-identities.js';
import { isMissingVaultPath } from './vault-read-errors.js';
import { bundleExecution } from './compilation-local-runtime.js';

/** Request-local, code-owned policy transition. Never accepted from MCP JSON. */
export interface PublicationBoundary { sources: readonly string[]; update(operation: () => Promise<void>): Promise<void> }
interface Publication {
  version: 1; bundleId: string; fingerprint: string; authority: string; sources: string[];
  state: 'applying' | 'applied' | 'reverting' | 'withdrawn'; attempts: number;
  requests: { id: string; operation: string }[];
}
function fail(): never { throw guidanceError(Error('Document publication unavailable; preserve journal and revalidate'), 'guid-65dd9939e4509847'); }
// Host principal enumeration has no transport session receipt. Match current
// authority fields; the request boundary separately verifies session validity.
const actorKey = (p: ScopePrincipal) => compilationHash({ account: p.accountId, model: p.modelId, agent: p.agentId,
  user: p.userId, center: p.commandCenterId, role: p.role, capabilities: p.capabilities, enterprise: p.enterprise });

/** Concrete owner adapter: existing private journal + filesystem change sets +
 * protected policy. No generic execution, model calls, or new grants. */
export class CompilationPublication {
  constructor(private readonly options: CompilationOptions) {}
  async execute(p: Record<string, any>, principal?: ScopePrincipal, transition?: PublicationBoundary): Promise<any> {
    const op = p.op, maxChars = p.maxChars ?? 4000, originalRead = op === 'split_original', mutation = !['split_preview', 'split_original'].includes(op);
    if (!['split_preview', 'split_apply', 'split_revert', 'split_original'].includes(op)
      || Object.keys(p).some(k => !['kind', 'op', 'bundleId', 'expectedJobRevision', 'expectedPublicationRevision', 'fingerprint', 'requestId', 'maxChars', ...(originalRead ? ['startOffset', 'endOffset'] : [])].includes(k))
      || !isDocumentBundleId(p.bundleId) || !isCompilationRevision(p.expectedJobRevision)
      || !Number.isInteger(maxChars) || maxChars < 1024 || maxChars > 12000
      || mutation && (this.options.readOnly || !compilationId(p.requestId) || !isCompilationRevision(p.fingerprint)
        || p.expectedPublicationRevision !== 'missing' && !isCompilationRevision(p.expectedPublicationRevision))) fail();
    const host = this.options.host, policy = this.options.documentPolicy;
    if (!host?.records || !policy) return { status: 'diagnostic_only', reason: 'publication_owner_not_connected' };
    if (!principal) fail();
    const records = host.records, fs = this.options.fs, access = this.options.access;
    const manifest = await records.read(bundleRecordId('manifest', p.bundleId));
    const bundle = parseCompilationBundle(manifest.value);
    if (bundle.bundleId !== p.bundleId || manifest.revision !== p.expectedJobRevision || bundle.accountId !== principal.accountId
      || bundle.status !== 'source_preserved' || bundle.mode !== 'synthesis_allowed') fail();
    const originalRecord = await records.read(bundleRecordId('original', bundle.bundleId));
    const original = parseBundleOriginal(originalRecord.value, bundle);
    const config = validateCompilationConfig(await host.refresh());
    const project = config.projects.find(x => x.id === bundle.projectId);
    const grant = project?.chapterBundles?.find(x => x.documentPath === bundle.documentPath && x.documentId === bundle.documentId && x.chapterRoot === bundle.chapterRoot);
    if (!config.enabled || !project || grant?.publication !== 'verbatim') return { status: 'diagnostic_only', reason: 'explicit_publication_grant_required' };
    const execution = bundleExecution(this.options, grant, bundle.mode);
    const plan = planVerbatimSplit(bundle.documentPath, original.text, { documentId: bundle.documentId, bundleId: bundle.bundleId,
      chapterRoot: bundle.chapterRoot, ruleVersion: project.ruleVersion });
    if (plan.status !== 'ready') return plan;
    const owner = plan.fingerprint, root = documentPolicyPath(bundle.chapterRoot);
    const paths = [bundle.chapterRoot, ...plan.chapters.map(c => c.path)];
    const filenames = plan.chapters.map(c => c.path.slice(c.path.lastIndexOf('/') + 1));
    const recordId = compilationHash({ kind: 'bundle-publication-v1', bundleId: bundle.bundleId });
    let record = await records.read(recordId), job = record.value as Publication | undefined;
    let boundary = access.captureDocumentBoundary(principal);
    const sourceAuthority = async () => {
      const actor = await this.options.authorize(principal.accountId);
      if (!actor || actorKey(actor) !== actorKey(principal) || !actor.capabilities?.includes('write')) fail();
      const fresh = validateCompilationConfig(await host.refresh());
      if (compilationHash(fresh) !== compilationHash(config)) fail();
      const runtime = await execution.runtime?.(actor, execution.operation, [bundle.documentPath]);
      const admitted = inspectCompilationPolicy({ config: { ...fresh, projects: [{ ...project, outputPaths: [bundle.documentPath] }] },
        projectId: project.id, principal: actor, access, paths: [bundle.documentPath], outputPath: bundle.documentPath,
        operation: execution.operation, ...(runtime && { runtime }) });
      if (admitted.status !== 'ready') fail();
      return compilationHash({ source: admitted.sourceFingerprint, config: fresh, actor: actorKey(actor) });
    };
    const authority = await sourceAuthority();
    const guard = async () => {
      if (await sourceAuthority() !== authority) fail();
      boundary();
      if (!access.canAccessPhysicalPath(bundle.documentPath, principal, false)
        || !access.canReadProtectedDocument(bundle.documentPath, principal, false)) fail();
    };
    const sourceRules = new DocumentAuthority(policy.rules()).effectiveConstraints(bundle.documentPath)
      .filter(r => r.confidential || r.realmId || r.accountIds || r.departmentIds).map(r => r.path);
    const sources = [...new Set([bundle.documentPath, ...sourceRules, ...(transition?.sources ?? [])].map(documentPolicyPath))].sort();
    const rule = () => policy.rules().find(r => r.path === root);
    const canonical = (value: unknown) => compilationHash(value === undefined ? null : new DocumentAuthority([value as any]).rules[0]);
    const released = () => ({ path: root, recursive: true, derivedFrom: job?.sources ?? sources });
    const held = () => ({ ...released(), publicationHold: owner });
    if (job) {
      if (Object.keys(job).sort().join(',') !== 'attempts,authority,bundleId,fingerprint,requests,sources,state,version'
        || job.version !== 1 || job.bundleId !== bundle.bundleId || job.fingerprint !== owner || job.authority !== authority
        || !['applying', 'applied', 'reverting', 'withdrawn'].includes(job.state)
        || !Number.isInteger(job.attempts) || job.attempts < 1 || job.attempts > 3
        || !Array.isArray(job.sources) || compilationHash(job.sources) !== compilationHash(sources)
        || !Array.isArray(job.requests) || job.requests.length > 8
        || job.requests.some(r => !compilationId(r.id) || !['split_apply', 'split_revert'].includes(r.operation))) fail();
      if (rule() && ![canonical(held()), canonical(released())].includes(canonical(rule()))) fail();
    } else {
      if (rule()) fail();
      // Only the original grant basis can start publication. A current ACL is
      // not enough to adopt a preservation made under unrelated conditions.
      const runtime = await execution.runtime?.(principal, execution.operation, [bundle.documentPath]);
      const base = inspectCompilationPolicy({ config: { ...config, projects: [{ ...project, outputPaths: [bundle.documentPath] }] },
        projectId: project.id, principal, access, paths: [bundle.documentPath], outputPath: bundle.documentPath,
        operation: execution.operation, ...(runtime && { runtime }) });
      if (base.status !== 'ready' || compilationHash({ policy: base.fingerprint, grant,
        outputRestrictions: access.documentDependencyFingerprint([`${bundle.chapterRoot}/chapter.md`]) }) !== bundle.authority) fail();
      if (await fs.assertManagedDirectory(bundle.chapterRoot, filenames, true)) fail();
    }
    const revision = async (path: string) => {
      try { return await fs.readNoteRevision(path, 128 * 1024); }
      catch (error) { if (isMissingVaultPath(error) || isMissingVaultPath((error as Error).cause)) return 'missing'; throw error; }
    };
    const inspect = () => withPublicationStaging(owner, paths, async () => {
      await guard();
      if (!paths.every(path => access.canAccessPhysicalPath(path, principal, false) && access.canReadProtectedDocument(path, principal, false))) fail();
      await fs.assertManagedDirectory(bundle.chapterRoot, filenames, true);
      const source = await revision(bundle.documentPath);
      const children = await Promise.all(plan.chapters.map(c => revision(c.path)));
      if (![bundle.sourceRevision, compilationContentHash(plan.toc)].includes(source)
        || children.some((r, i) => r !== 'missing' && r !== plan.chapters[i]!.revision)) fail();
      await guard(); return { source, children };
    });
    const view = (status: string) => ({ status, bundleId: bundle.bundleId, jobRevision: manifest.revision, publicationRevision: record.revision,
      fingerprint: owner, effectVerified: false, outputs: plan.chapters.map(c => ({ path: access.toPublicPath(c.path), revision: c.revision })),
      ...(status === 'withdrawn' && { chapters: 'retained_hidden_for_recovery' }) });
    const output = async (status: string) => {
      await guard();
      if ((await records.read(bundleRecordId('manifest', bundle.bundleId))).revision !== manifest.revision
        || (await records.read(bundleRecordId('original', bundle.bundleId))).revision !== originalRecord.revision
        || (await records.read(recordId)).revision !== record.revision) fail();
      if (!originalRead && ['applied', 'withdrawn'].includes(status)) {
        const actual = await inspect(), applied = status === 'applied';
        if (actual.source !== (applied ? compilationContentHash(plan.toc) : bundle.sourceRevision)
          || applied && actual.children.some((r, i) => r !== plan.chapters[i]!.revision)
          || canonical(rule()) !== canonical(applied ? released() : held())) fail();
      }
      const result: ReturnType<typeof view> & { partial?: boolean; nextAction?: unknown } = view(status);
      if (JSON.stringify(result).length > maxChars) {
        result.partial = true;
        result.nextAction = { endpointId: 'wiki.compilation', arguments: { kind: 'document_bundle', op: 'split_preview',
          bundleId: bundle.bundleId, expectedJobRevision: manifest.revision, maxChars: 12000 } };
        while (result.outputs.length && JSON.stringify(result).length > maxChars) result.outputs.pop();
      }
      if (JSON.stringify(result).length > maxChars) fail(); return result;
    };
    if (originalRead) {
      if (!job) fail();
      const start = p.startOffset ?? 0, stop = p.endOffset ?? original.text.length;
      const splitSurrogate = (n: number) => n > 0 && /[\ud800-\udbff]/.test(original.text[n - 1]!) && /[\udc00-\udfff]/.test(original.text[n] ?? '');
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop) || start < 0 || stop < start || stop > original.text.length
        || splitSurrogate(start) || splitSurrogate(stop)) fail();
      const currentRevision = await revision(bundle.documentPath);
      const page = (end: number) => ({ bundleId: bundle.bundleId, sourceRevision: original.revision,
        sourceState: currentRevision === original.revision ? 'current' : 'historical',
        part: { startOffset: start, endOffset: end, text: original.text.slice(start, end) }, partial: end < stop,
        ...(end < stop && { nextAction: { endpointId: 'wiki.compilation', arguments: { kind: 'document_bundle', op: 'read', projection: 'original',
          bundleId: bundle.bundleId, expectedJobRevision: manifest.revision, startOffset: end, endOffset: stop, maxChars } } }) });
      let low = start, high = Math.min(stop, start + maxChars);
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (JSON.stringify(page(mid)).length <= maxChars) low = mid; else high = mid - 1; }
      if (splitSurrogate(low)) low--;
      if (low === start && start < stop || JSON.stringify(page(low)).length > maxChars) fail();
      await output(job.state);
      if (await revision(bundle.documentPath) !== currentRevision) fail();
      await guard(); return page(low);
    }
    const initial = await inspect();
    if (!job && initial.source !== bundle.sourceRevision) fail();
    if (job?.state === 'applied' && (initial.source !== compilationContentHash(plan.toc)
      || initial.children.some((r, i) => r !== plan.chapters[i]!.revision) || canonical(rule()) !== canonical(released()))) fail();
    if (job?.state === 'withdrawn' && (initial.source !== bundle.sourceRevision || canonical(rule()) !== canonical(held()))) fail();
    if (job && !rule() && (initial.source !== bundle.sourceRevision || initial.children.some(r => r !== 'missing'))) fail();
    if (op === 'split_preview') return output(job?.state ?? 'ready');
    if (p.fingerprint !== owner) fail();
    const duplicate = job?.requests.find(r => r.id === p.requestId);
    if (duplicate && duplicate.operation !== op) fail();
    if (duplicate && ((op === 'split_apply' && job!.state === 'applied') || (op === 'split_revert' && job!.state === 'withdrawn'))) {
      if (initial.source !== (op === 'split_apply' ? compilationContentHash(plan.toc) : bundle.sourceRevision)
        || op === 'split_apply' && initial.children.some((r, i) => r !== plan.chapters[i]!.revision)
        || canonical(rule()) !== canonical(op === 'split_apply' ? released() : held())) fail();
      return output(job!.state);
    }
    if (p.expectedPublicationRevision !== record.revision || job?.state === 'withdrawn'
      || op === 'split_revert' && !job || op === 'split_apply' && job?.state === 'reverting') fail();
    const writer = await host.acquire();
    try {
      if ((await records.read(recordId)).revision !== record.revision) fail();
      await guard();
      const save = async () => { record = { ...(await records.write(recordId, job, record.revision, async () => { await guard(); await writer.assertHeld(); })), value: job }; };
      // Reconcile durable completion before the retry budget. This writes only
      // the receipt, never replays a completed cutover after a lost response.
      if (job && (op === 'split_apply' && canonical(rule()) === canonical(released())
        || op === 'split_revert' && job.state === 'reverting' && canonical(rule()) === canonical(held()))) {
        const actual = await inspect();
        if (actual.source === (op === 'split_apply' ? compilationContentHash(plan.toc) : bundle.sourceRevision)
          && (op === 'split_revert' || actual.children.every((r, i) => r === plan.chapters[i]!.revision))) {
          if (!duplicate) { if (job.requests.length >= 8) fail(); job.requests.push({ id: p.requestId, operation: op }); }
          job.state = op === 'split_apply' ? 'applied' : 'withdrawn'; await save();
          return output(job.state);
        }
      }
      // Publication exhaustion must not disable recovery. Withdrawal has its
      // own three attempts, and state transitions cannot reset that budget.
      if (job && op === 'split_revert' && job.state !== 'reverting') job.attempts = 0;
      if (job && job.attempts >= 3) return output('review_required');
      job ??= { version: 1, bundleId: bundle.bundleId, fingerprint: owner, authority, sources, state: 'applying', attempts: 0, requests: [] };
      if (!duplicate) { if (job.requests.length >= 8) fail(); job.requests.push({ id: p.requestId, operation: op }); }
      job.attempts++;
      job.state = op === 'split_revert' ? 'reverting' : 'applying'; await save();
      const changePolicy = async (change: () => Promise<void>) => {
        await guard();
        const others = compilationHash(policy.rules().filter(r => r.path !== root));
        if (activeDocumentStorageContext() && !transition) fail();
        if (transition) await transition.update(change); else await change();
        if (compilationHash(policy.rules().filter(r => r.path !== root)) !== others || await sourceAuthority() !== authority) fail();
        boundary = access.captureDocumentBoundary(principal); await guard();
      };
      if (!rule()) await changePolicy(() => policy.beginPublication(bundle.chapterRoot, sources, owner, policy.revision()));
      else if (canonical(rule()) === canonical(released())) {
        if (op === 'split_apply') {
          const actual = await inspect();
          if (actual.source !== compilationContentHash(plan.toc) || actual.children.some((r, i) => r !== plan.chapters[i]!.revision)) fail();
          job.state = 'applied'; await save(); return output(job.state);
        }
        await changePolicy(() => policy.holdPublished(bundle.chapterRoot, owner, released(), policy.revision()));
      }
      if (canonical(rule()) !== canonical(held())) fail();
      await withPublicationStaging(owner, paths, async () => {
        let actual = await inspect();
        if (op === 'split_apply') {
          for (let i = 0; i < plan.chapters.length; i++) {
            const chapter = plan.chapters[i]!;
            if (actual.children[i] === 'missing') {
              if (actual.source !== bundle.sourceRevision) fail();
              access.assertMutationAllowed(chapter.path, 'wiki.compilation');
              await fs.writeNoteWithRevisionGuardsAndReceipt({ path: chapter.path, content: chapter.content, expectedRevision: 'missing' },
                [{ path: bundle.documentPath, expectedRevision: bundle.sourceRevision }], { assertAccess: guard });
              actual = await inspect();
            }
          }
        }
        const expected = op === 'split_apply' ? bundle.sourceRevision : compilationContentHash(plan.toc);
        const content = op === 'split_apply' ? plan.toc : original.text;
        if (actual.source === expected) {
          if (actual.children.some((r, i) => r !== plan.chapters[i]!.revision)) fail();
          const changes = [{ path: bundle.documentPath, expectedRevision: expected, patches: [{ oldString: op === 'split_apply' ? original.text : plan.toc, newString: content }] }];
          const writePolicy = { assertAccess: guard, guards: plan.chapters.map(c => ({ path: c.path, expectedRevision: c.revision })) };
          access.assertMutationAllowed(bundle.documentPath, 'wiki.compilation');
          const preview = await fs.patchMultipleNotes({ changes, dryRun: true }, undefined, writePolicy);
          if (preview.changes[0]?.revision !== compilationContentHash(content)) fail();
          await fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, undefined, writePolicy);
        }
        actual = await inspect();
        if (actual.source !== compilationContentHash(content) || op === 'split_apply' && actual.children.some((r, i) => r !== plan.chapters[i]!.revision)) fail();
      });
      if (op === 'split_apply') {
        await changePolicy(() => policy.finishPublication(bundle.chapterRoot, owner, policy.revision()));
        try {
          const verified = await inspect();
          if (verified.source !== compilationContentHash(plan.toc) || verified.children.some((r, i) => r !== plan.chapters[i]!.revision)) fail();
        } catch (error) {
          // Restriction-only recovery. Never repair or overwrite edited bytes.
          if (canonical(rule()) === canonical(released())) await changePolicy(() => policy.holdPublished(bundle.chapterRoot, owner, released(), policy.revision()));
          throw error;
        }
      }
      job.state = op === 'split_apply' ? 'applied' : 'withdrawn'; await save();
      return output(job.state);
    } finally { await writer.close(); }
  }
}
