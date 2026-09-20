import { guidanceError } from './guidance-runtime.js';
import type { CompilationOptions } from './compilation-service.js';
import type { ScopePrincipal } from './scope-auth.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';
import { DocumentResourceReader } from './document-resource.js';
import { withDocumentWork, reserveDocumentWork, documentFrontmatterEstimate, documentParseEstimate } from './document-work-memory.js';
import { compilationId, isCompilationRevision } from './compilation-model.js';
import { compilationHash, compilationPath, inspectCompilationPolicy, validateCompilationConfig, type CompilationConfig } from './compilation-policy.js';
import { isDocumentBundleId } from './document-bundle-identities.js';
import { bundleIdentity, bundleRecordId, parseCompilationBundle, parseBundleOriginal, type CompilationBundle } from './compilation-bundle-model.js';
import { parseDocumentStructure } from './document-structure.js';
import { createBundlePlan } from './document-bundle-plan.js';
import { chapterCandidate, chapterPlanPage } from './compilation-bundle-candidates.js';
import { CompilationPublication, type PublicationBoundary } from './compilation-publication.js';
import { bundleExecution } from './compilation-local-runtime.js';

const unavailable = () => guidanceError(new Error('Document bundle unavailable'), 'guid-72ba6eede0a50b17');
const actorBasis = (p: ScopePrincipal) => compilationHash({ account: p.accountId, model: p.modelId, agent: p.agentId,
  user: p.userId, center: p.commandCenterId, role: p.role, capabilities: p.capabilities, enterprise: p.enterprise });

/** Private preservation and projections; physical writes delegate to publication.
 * A journal receipt is not a grant. Every return rechecks current admission. */
export class CompilationBundleService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: CompilationOptions) {}
  execute(params: Record<string, any>, principal?: ScopePrincipal, publicationBoundary?: PublicationBoundary): Promise<any> {
    // Capture incoming values before queuing; clients cannot change a queued plan.
    let input: Record<string, any>;
    try { input = JSON.parse(JSON.stringify(params)); } catch { return Promise.reject(unavailable()); }
    const operation = this.tail.then(() => withDocumentWork(async () => {
      if (String(input.op).startsWith('split_')) return new CompilationPublication(this.options).execute(input, principal, publicationBoundary);
      if (input.op === 'read' && input.projection === 'original' && isDocumentBundleId(input.bundleId)
        && (await this.options.host?.records?.read(compilationHash({ kind: 'bundle-publication-v1', bundleId: input.bundleId })))?.value !== undefined) {
        const { projection: _projection, ...rest } = input;
        return new CompilationPublication(this.options).execute({ ...rest, op: 'split_original' }, principal, publicationBoundary);
      }
      return this.run(input, principal);
    }));
    this.tail = operation.catch(() => undefined);
    return operation.catch(() => { throw unavailable(); });
  }
  private async actor(principal?: ScopePrincipal): Promise<ScopePrincipal> {
    if (!principal) throw unavailable();
    const current = await this.options.authorize(principal.accountId);
    if (!current || actorBasis(current) !== actorBasis(principal) || !current.capabilities?.includes('write')) throw unavailable();
    return current;
  }
  private async admission(config: CompilationConfig, projectId: string, path: string, principal: ScopePrincipal) {
    const project = config.projects.find(p => p.id === projectId);
    const grant = project?.chapterBundles?.find(g => g.documentPath === path);
    if (!project || !grant) return { status: 'diagnostic_only' as const };
    const mode = project.sources.find(s => s.path === path)!.mode;
    const execution = bundleExecution(this.options, grant, mode), operation = execution.operation;
    // Only this explicit host grant admits preservation. Do not extend the
    // general output policy or infer permission from legacy outputPaths.
    const scoped = { ...config, projects: [{ ...project, outputPaths: [path] }] };
    const base = { config: scoped, projectId, principal, access: this.options.access, paths: [path], outputPath: path, operation } as const;
    let result = inspectCompilationPolicy({ ...base, paths: [path] });
    if (result.status === 'waiting_runtime') {
      const runtime = await execution.runtime?.(principal, operation, [path]);
      result = inspectCompilationPolicy({ ...base, paths: [path], ...(runtime && { runtime }) });
    }
    if (result.status !== 'ready') return result;
    if (!this.options.access.canAccessPhysicalPath(`${grant.chapterRoot}/chapter.md`, principal, false)) throw unavailable();
    return { status: 'ready' as const, grant, mode, authority: compilationHash({ policy: result.fingerprint, grant,
      outputRestrictions: this.options.access.documentDependencyFingerprint([`${grant.chapterRoot}/chapter.md`]) }) };
  }
  private summary(bundle: CompilationBundle, jobRevision: string, verbatim: boolean) {
    return { status: bundle.status, bundleId: bundle.bundleId, documentId: bundle.documentId, jobRevision,
      sourceRevision: bundle.sourceRevision, mode: bundle.mode, originalPreserved: bundle.status === 'source_preserved',
      generationAllowed: !verbatim && bundle.mode === 'synthesis_allowed', automaticApplication: false };
  }
  private async run(params: Record<string, any>, principal?: ScopePrincipal): Promise<any> {
    const op = params.op ?? 'diagnose', maxChars = params.maxChars ?? 4000;
    const allowed = ['kind', 'op', 'maxChars', ...(op === 'prepare' ? ['requestId', 'projectId', 'documentPath', 'expectedDocumentRevision'] :
      op === 'read' ? ['bundleId', 'expectedJobRevision', 'projection', 'startOffset', 'endOffset', 'chapterCursor', 'expectedPlanRevision', 'chapterId', 'expectedCandidateRevision'] :
      op === 'submit' ? ['bundleId', 'expectedJobRevision', 'expectedPlanRevision', 'chapterId', 'requestId', 'metadata', 'content'] : [])];
    if (Object.keys(params).some(key => !allowed.includes(key)) || !['diagnose', 'prepare', 'read', 'submit'].includes(op)
      || !Number.isSafeInteger(maxChars) || maxChars < 512 || maxChars > 12000
      || params.startOffset !== undefined && !['original', 'candidate'].includes(params.projection)
      || params.endOffset !== undefined && params.projection !== 'original'
      || ['original', 'plan', 'candidate'].includes(params.projection) && maxChars < 1024
      || params.chapterCursor !== undefined && params.projection !== 'plan'
      || op === 'read' && params.chapterId !== undefined && params.projection !== 'candidate'
      || params.expectedCandidateRevision !== undefined && params.projection !== 'candidate'
      || op === 'read' && params.expectedPlanRevision !== undefined && !['plan', 'candidate'].includes(params.projection)
      || this.options.readOnly && !['diagnose', 'read'].includes(op)) throw unavailable();
    const host = this.options.host;
    if (!host?.records) return { status: 'diagnostic_only', automaticApplication: false };
    const records = host.records, config = validateCompilationConfig(await host.refresh());
    if (!config.enabled) return { status: 'diagnostic_only', automaticApplication: false };
    const current = await this.actor(principal);
    if (current.accountId !== config.accountId) throw unavailable();
    const boundary = this.options.access.captureDocumentBoundary(current);
    if (op === 'diagnose') return { status: 'diagnostic_only', automaticApplication: false, admission: 'explicit_document_bundle_grant_required' };
    let bundle: CompilationBundle, manifest: Awaited<ReturnType<typeof records.read>>;
    if (op === 'prepare') {
      if (!compilationId(params.projectId) || !compilationId(params.requestId) || !isCompilationRevision(params.expectedDocumentRevision)) throw unavailable();
      const path = compilationPath(params.documentPath);
      const gate = await this.admission(config, params.projectId, path, current);
      if (gate.status === 'unavailable') throw unavailable();
      if (gate.status !== 'ready') return { status: gate.status, automaticApplication: false };
      const basis = { version: 1 as const, documentId: gate.grant.documentId, documentPath: path, chapterRoot: gate.grant.chapterRoot,
        projectId: params.projectId, accountId: current.accountId, sourceRevision: params.expectedDocumentRevision, authority: gate.authority, mode: gate.mode };
      bundle = { ...basis, bundleId: bundleIdentity(basis), status: 'prepared', attempts: 0 };
      manifest = await records.read(bundleRecordId('manifest', bundle.bundleId));
      if (manifest.value !== undefined) {
        const saved = parseCompilationBundle(manifest.value);
        if (compilationHash({ ...saved, status: 'prepared', attempts: 0 }) !== compilationHash(bundle)) throw unavailable();
        bundle = saved;
      }
    } else {
      if (!isDocumentBundleId(params.bundleId)) throw unavailable();
      manifest = await records.read(bundleRecordId('manifest', params.bundleId));
      bundle = parseCompilationBundle(manifest.value);
      if (bundle.bundleId !== params.bundleId || bundle.accountId !== current.accountId) throw unavailable();
    }
    const verbatim = config.projects.find(p => p.id === bundle.projectId)?.chapterBundles?.find(g => g.documentPath === bundle.documentPath)?.processing === 'verbatim';
    if (verbatim && (op === 'submit' || params.projection === 'candidate')) throw unavailable();
    const assertCurrent = async () => {
      await this.actor(current);
      const fresh = validateCompilationConfig(await host.refresh());
      const gate = await this.admission(fresh, bundle.projectId, bundle.documentPath, current);
      if (gate.status !== 'ready' || gate.authority !== bundle.authority || gate.grant.documentId !== bundle.documentId
        || gate.mode !== bundle.mode || gate.grant.chapterRoot !== bundle.chapterRoot) throw unavailable();
      boundary();
    };
    await assertCurrent();
    const requestRecord = op === 'prepare' ? compilationHash({ kind: 'document-bundle-request-v1', accountId: current.accountId, requestId: params.requestId }) : undefined;
    const requestValue = { version: 1, bundleId: bundle.bundleId };
    const checkRequest = async () => {
      const saved = await records.read(requestRecord!);
      if (saved.value !== undefined && compilationHash(saved.value) !== compilationHash(requestValue)) throw unavailable();
      return saved;
    };
    const request = requestRecord ? await checkRequest() : undefined;
    // A request binding is committed only after its manifest. Its surviving
    // presence (or an orphan original) proves that an absent manifest was lost.
    if (op === 'prepare' && manifest.value === undefined && (request?.value !== undefined
      || (await records.read(bundleRecordId('original', bundle.bundleId))).value !== undefined)) throw unavailable();
    const reader = new DocumentResourceReader(this.options.fs, new PathFilter(), this.options.access);
    const snapshot = await reader.read(this.options.access.toPublicPath(bundle.documentPath), current, { maxBytes: 512 * 1024 });
    // Managed records remain owned by their service even outside a known folder.
    reserveDocumentWork(documentFrontmatterEstimate(snapshot.text!));
    const fm = new FrontmatterHandler().parse(snapshot.text!).frontmatter;
    if (['mcpvault_type', 'context_bundle_id', 'immutable', 'source_id'].some(key => Object.hasOwn(fm, key))
      || fm.llm_wiki_type !== undefined && !['knowledge', 'manual', 'tool'].includes(String(fm.llm_wiki_type))) throw unavailable();
    if (snapshot.revision !== bundle.sourceRevision && !(op === 'read' && params.projection === 'original')) {
      await assertCurrent(); await reader.assertCurrent(snapshot, current);
      return { status: 'review_required', reason: 'input_changed', automaticApplication: false };
    }
    const manifestId = bundleRecordId('manifest', bundle.bundleId), originalId = bundleRecordId('original', bundle.bundleId);
    const writeRecord = (id: string, value: unknown, revision: string) => records.write(id, value, revision, async () => {
      await assertCurrent(); await reader.assertCurrent(snapshot, current);
    });
    if (op === 'prepare' && (bundle.status === 'prepared' || request?.value === undefined)) {
      const writer = await host.acquire();
      try {
        // Reread under the cross-process lease. Never overwrite another result.
        const locked = await records.read(manifestId);
        if (locked.revision !== manifest.revision) throw unavailable();
        await assertCurrent(); await reader.assertCurrent(snapshot, current);
        const lockedRequest = await checkRequest();
        if (locked.value === undefined && (lockedRequest.value !== undefined
          || (await records.read(originalId)).value !== undefined)) throw unavailable();
        if (bundle.status === 'prepared') {
          if (bundle.attempts >= 3) return { status: 'review_required', reason: 'attempt_limit', automaticApplication: false };
          await assertCurrent(); await reader.assertCurrent(snapshot, current);
          bundle = { ...bundle, attempts: bundle.attempts + 1 };
          await writeRecord(manifestId, bundle, locked.revision);
          if (lockedRequest.value === undefined) await writeRecord(requestRecord!, requestValue, lockedRequest.revision);
          // The account/restriction/source basis exists durably before body bytes.
          const original = await records.read(originalId);
          if (original.value === undefined) {
            await assertCurrent(); await reader.assertCurrent(snapshot, current);
            await writeRecord(originalId, { version: 1, bundleId: bundle.bundleId, path: bundle.documentPath,
              revision: snapshot.revision, byteLength: snapshot.bytes.length, text: snapshot.text! }, original.revision);
          }
          parseBundleOriginal((await records.read(originalId)).value, bundle);
          await assertCurrent(); await reader.assertCurrent(snapshot, current); await writer.assertHeld();
          const preserved = await records.read(manifestId);
          if (compilationHash(parseCompilationBundle(preserved.value)) !== compilationHash(bundle)) throw unavailable();
          bundle = { ...bundle, status: 'source_preserved' };
          await writeRecord(manifestId, bundle, preserved.revision);
          manifest = await records.read(manifestId);
          if (compilationHash(parseCompilationBundle(manifest.value)) !== compilationHash(bundle)) throw unavailable();
        } else if (lockedRequest.value === undefined) await writeRecord(requestRecord!, requestValue, lockedRequest.revision);
      } finally { await writer.close(); }
    }
    const saved = await records.read(originalId);
    const original = bundle.status === 'source_preserved' ? parseBundleOriginal(saved.value, bundle) : undefined;
    reserveDocumentWork((original?.text.length ?? 0) * 4 + 65536);
    let response: any = this.summary(bundle, manifest.revision, verbatim);
    if (op === 'submit' || ['plan', 'candidate'].includes(params.projection)) {
      if (!original || params.expectedJobRevision !== manifest.revision) throw unavailable();
      reserveDocumentWork(documentParseEstimate(original.text));
      const source = parseDocumentStructure({ path: bundle.documentPath, raw: original.text });
      reserveDocumentWork(source.fragments.length * 1200 + original.text.length * 8 + 65536);
      const plan = createBundlePlan(source, { documentId: bundle.documentId, bundleId: bundle.bundleId, chapterRoot: bundle.chapterRoot,
        ruleVersion: config.projects.find(p => p.id === bundle.projectId)!.ruleVersion });
      const assertReferences = (paths: string[]) => {
        if (!paths.every(path => this.options.access.canAccessPhysicalPath(path, current, false))) throw unavailable();
      };
      const guard = async () => {
        await assertCurrent(); await reader.assertCurrent(snapshot, current);
        assertReferences(plan.items.map(item => item.path));
      };
      // Host record writes serialize their callbacks. Never reenter records.read
      // from that callback; the outer call verifies parent records before/after.
      if ((await records.read(manifestId)).revision !== manifest.revision || (await records.read(originalId)).revision !== saved.revision) throw unavailable();
      await guard();
      const reservedBodies = new Set<string>();
      const context = { bundle, source, plan, jobRevision: manifest.revision, records,
        acquire: () => host.acquire(), assertCurrent: guard, assertReferences, reserveCandidate: (raw: string) => {
          if (!reservedBodies.has(raw)) { reserveDocumentWork(documentParseEstimate(raw)); reservedBodies.add(raw); }
        } };
      response = params.projection === 'plan' ? chapterPlanPage(context, params) : await chapterCandidate(context, params);
      await guard();
    } else if (op === 'read' && params.projection === 'original') {
      if (!original || params.expectedJobRevision !== manifest.revision) throw unavailable();
      const start = params.startOffset ?? 0, text = original.text, stop = params.endOffset ?? text.length;
      if (!Number.isSafeInteger(start) || start < 0 || start > text.length
        || !Number.isSafeInteger(stop) || stop < start || stop > text.length
        || stop > 0 && /[\ud800-\udbff]/.test(text[stop - 1]!) && /[\udc00-\udfff]/.test(text[stop] ?? '')
        || start > 0 && /[\ud800-\udbff]/.test(text[start - 1]!) && /[\udc00-\udfff]/.test(text[start] ?? '')) throw unavailable();
      const page = (end: number) => ({ bundleId: bundle.bundleId, sourceRevision: original.revision,
        sourceState: snapshot.revision === original.revision ? 'current' : 'historical',
        part: { startOffset: start, endOffset: end, text: text.slice(start, end) }, partial: end < stop,
        ...(end < stop && { nextAction: { endpointId: 'wiki.compilation', arguments: { kind: 'document_bundle', op: 'read', bundleId: bundle.bundleId,
          expectedJobRevision: manifest.revision, projection: 'original', startOffset: end, ...(params.endOffset !== undefined && { endOffset: stop }), maxChars } } }) });
      let low = start, high = Math.min(stop, start + maxChars);
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (JSON.stringify(page(mid)).length <= maxChars) low = mid; else high = mid - 1; }
      if (low > start && low < text.length && /[\ud800-\udbff]/.test(text[low - 1]!) && /[\udc00-\udfff]/.test(text[low]!)) low--;
      if (low === start && start < stop) throw unavailable();
      response = page(low);
    } else if (params.projection !== undefined && params.projection !== 'summary') throw unavailable();
    if (JSON.stringify(response).length > maxChars) throw unavailable();
    // Neither host-record replacement nor body/policy drift can validate a stale receipt.
    if ((await records.read(manifestId)).revision !== manifest.revision || (await records.read(originalId)).revision !== saved.revision) throw unavailable();
    if (requestRecord) await checkRequest();
    await reader.assertCurrent(snapshot, current); await assertCurrent();
    return response;
  }
}
