import { guidanceError, guidanceText } from './guidance-runtime.js';
import { randomUUID } from 'node:crypto';
import { fingerprint, integer, listField, page, textField } from './work-model.js';
export class ReviewBudgetError extends Error {
}
const MAX_CONTEXT_LINES = 1000;
function assertDeliverable(lines) {
    if (lines.some(line => JSON.stringify(line).length > 8000))
        throw new ReviewBudgetError('Review source line exceeds delivery budget; split the source or change scope');
}
function object(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k)))
        throw guidanceError(new Error(`Invalid ${label} fields`), 'guid-fb00ae712bdd0fd6');
    return value;
}
export function reviewPolicy(value) {
    const p = object(value, ['version', 'requireHostExecution', 'optionalCriteria'], 'review policy');
    if (p.version !== 2 || (p.requireHostExecution !== undefined && typeof p.requireHostExecution !== 'boolean'))
        throw guidanceError(new Error('Review policy requires version 2 and a boolean execution requirement'), 'guid-ab123ba563f282de');
    return { version: 2, ...(p.requireHostExecution !== undefined && { requireHostExecution: p.requireHostExecution }),
        ...(p.optionalCriteria !== undefined && { optionalCriteria: listField(p.optionalCriteria, 'optionalCriteria') }) };
}
export function effectiveReviewPolicy(task, project) {
    const initial = reviewPolicy(task.work_review_policy), current = project.review_policy ? reviewPolicy(project.review_policy) : initial;
    return { version: 2, requireHostExecution: Boolean(initial.requireHostExecution || current.requireHostExecution),
        optionalCriteria: task.work_kind === 'general' ? (initial.optionalCriteria || []).filter(c => current.optionalCriteria?.includes(c)) : [] };
}
export function changeContext(value) {
    const c = object(value, ['reason', 'scope', 'constraints', 'decisions', 'risks', 'dissent', 'unverified', 'locators'], 'change context');
    if (!Array.isArray(c.locators) || c.locators.length > 20)
        throw guidanceError(new Error('Change context locators must be an array of at most 20'), 'guid-2052691eaa5f9f57');
    const locators = c.locators.map((value) => {
        const l = object(value, ['id', 'role', 'path', 'revision', 'repository', 'commit', 'file', 'startLine', 'endLine', 'required'], 'context locator');
        const id = textField(l.id, 'locator id', 64, true);
        if (!/^[a-z0-9_-]+$/.test(id) || !['before', 'after', 'diff', 'source', 'test', 'upstream'].includes(l.role))
            throw guidanceError(new Error('Invalid context locator id or role'), 'guid-835b595422800927');
        const startLine = integer(l.startLine, 1, 1_000_000, 'startLine'), endLine = integer(l.endLine, startLine, 1_000_000, 'endLine');
        if (endLine < startLine || endLine - startLine >= 1000 || (l.required !== undefined && typeof l.required !== 'boolean'))
            throw guidanceError(new Error('Invalid bounded context range or requirement'), 'guid-b8114a28ea0f2163');
        const base = { id, role: l.role, startLine, endLine, required: l.required !== false };
        if (l.path !== undefined) {
            if (l.repository !== undefined || l.commit !== undefined || l.file !== undefined)
                throw guidanceError(new Error('Context locator must name one source'), 'guid-10c6d54b40d5d025');
            const revision = textField(l.revision, 'revision', 128, true);
            if (!/^[a-f0-9]{64}$/i.test(revision))
                throw guidanceError(new Error('Context requires exact note revision'), 'guid-9e01a1ae7aa4a55f');
            return { ...base, path: textField(l.path, 'context path', 500, true), revision };
        }
        const repository = textField(l.repository, 'repository', 300, true), commit = textField(l.commit, 'commit', 64, true), file = textField(l.file, 'file', 500, true);
        const url = new URL(repository);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit)
            || file.startsWith('/') || file.includes('\\') || /[:\0]/.test(file) || file.split('/').some(p => !p || p === '..' || p === '.' || /[. ]$/.test(p)))
            throw guidanceError(new Error('Context Git locator requires credential-free HTTPS, immutable commit, and canonical relative file'), 'guid-7ee835a9dc730980');
        return { ...base, repository, commit, file };
    });
    if (new Set(locators.map(l => l.id)).size !== locators.length)
        throw guidanceError(new Error('Duplicate context locator id'), 'guid-466217a698791381');
    const result = { reason: textField(c.reason, 'change reason', 1000, true), scope: textField(c.scope, 'change scope', 1000, true), locators };
    for (const key of ['constraints', 'decisions', 'risks', 'dissent', 'unverified'])
        result[key] = listField(c[key] ?? [], key);
    return result;
}
/** Ephemeral delivery proof; restart/expiry requires rereading, not a durable approval.
 * Tokens attest delivery only. Review claims remain claims unless the host verifies execution. */
export class WorkReviewEngine {
    reader;
    verifyExecution;
    receipts = new Map();
    constructor(reader, verifyExecution) {
        this.reader = reader;
        this.verifyExecution = verifyExecution;
    }
    async state(fm, project, strict = false) {
        const context = fm.change_context ? changeContext(fm.change_context) : undefined;
        let selectedLines = (context?.locators || []).reduce((sum, l) => sum + l.endLine - l.startLine + 1, 0);
        const admitLines = (additional = 0) => { selectedLines += additional; if (selectedLines > MAX_CONTEXT_LINES)
            throw new ReviewBudgetError('Review context exceeds cumulative 1000-line receipt budget; split the task or selected ranges'); };
        admitLines();
        const guards = [];
        const sources = [];
        // Parent/dependency notes are implicit upstream contracts, even when the
        // author omitted them from the explicit evidence locator list.
        const upstreamIds = [...new Set([fm.parent_task_id, ...(fm.depends_on || [])].filter(Boolean))];
        const visited = new Set();
        const implicit = [];
        for (const id of upstreamIds) {
            if (visited.has(id))
                continue;
            if (visited.size >= 100)
                throw guidanceError(new Error('Upstream review context exceeds bounded dependency graph'), 'guid-cf8d9398d8bbe531');
            visited.add(id);
            if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))
                throw guidanceError(new Error('Invalid upstream task identity'), 'guid-1eef6ee3e56c7934');
            try {
                const locator = { id: `upstream-${fingerprint(id).slice(0, 16)}`, role: 'upstream', path: `Community/Tasks/${id}.md`, startLine: 1, endLine: 1, required: true };
                const source = await this.reader(locator);
                if (source.projectId !== fm.project_id)
                    throw guidanceError(new Error('Upstream task must belong to the same project'), 'guid-88207bed3df2bcf9');
                if (source.guard)
                    guards.push(source.guard);
                sources.push({ upstreamTaskId: id, revision: source.revision, available: true });
                locator.revision = source.revision;
                locator.endLine = source.content.split(/\r?\n/).length;
                admitLines(locator.endLine);
                assertDeliverable(source.content.split(/\r?\n/));
                if (locator.endLine > 1000 || context?.locators.some(l => l.id === locator.id))
                    throw guidanceError(new Error('Upstream context range exceeds budget or collides with an explicit locator'), 'guid-f149b8b79b3925d4');
                implicit.push(locator);
                upstreamIds.push(...(source.relatedTaskIds || []).filter(related => !visited.has(related)));
            }
            catch (error) {
                if (error instanceof ReviewBudgetError)
                    throw error;
                if (strict)
                    throw guidanceError(new Error('Required upstream context is unavailable'), 'guid-42e5e87655d24120');
                sources.push({ upstreamTaskId: id, available: false });
            }
        }
        for (const locator of context?.locators || []) {
            try {
                const source = await this.reader(locator);
                if (source.guard)
                    guards.push(source.guard);
                const expected = locator.revision || locator.commit;
                if (source.revision !== expected)
                    throw guidanceError(new Error('Context revision is stale'), 'guid-cf1914342165a2fc');
                if (source.content.split(/\r?\n/).length < locator.endLine)
                    throw guidanceError(new Error('Context range is outside the source'), 'guid-388a863813627e1c');
                assertDeliverable(source.content.split(/\r?\n/).slice(locator.startLine - 1, locator.endLine));
                sources.push({ id: locator.id, revision: source.revision, digest: fingerprint(source.content), available: true });
            }
            catch (error) {
                if (error instanceof ReviewBudgetError)
                    throw error;
                if (strict)
                    throw guidanceError(new Error('Required review context is unavailable or stale; refresh exact locators'), 'guid-0e5e519871f53169');
                sources.push({ id: locator.id, available: false });
            }
        }
        if (context)
            context.locators.push(...implicit);
        return { fingerprint: fingerprint({ context, sources, goal: project.goal, criteria: project.completion_criteria,
                allowedWork: project.allowed_work, perspectives: project.required_perspectives, policy: project.review_policy, initialPolicy: fm.work_review_policy,
                parent: fm.parent_task_id, dependencies: fm.depends_on, generation: fm.claim_generation }), guards, context, sources };
    }
    async read(params) {
        const c = params.context;
        if (!c)
            throw guidanceError(new Error('Task requires a change context before evidence can be delivered'), 'guid-a480cbce1e26a40b');
        const meta = { taskId: params.taskId, artifactFingerprint: params.basis, advisory: true,
            warning: guidanceText('guid-0235a26815acbf34', 'Delivery is not understanding. Self-reported tests are not host-observed execution.') };
        const signature = fingerprint({ basis: params.basis, account: params.accountId, locator: params.locatorId });
        if (!params.locatorId) {
            const items = [{ kind: 'goal', text: String(params.project.goal || '') },
                ...params.criteria.map(criterion => ({ kind: 'criterion', criterion })),
                { kind: 'reason', text: c.reason }, { kind: 'scope', text: c.scope },
                ...['constraints', 'decisions', 'risks', 'dissent', 'unverified'].flatMap(kind => c[kind].map(text => ({ kind, text }))),
                ...c.locators.map(locator => ({ kind: 'locator', ...locator, nextAction: { endpoint: 'work.review_context', args: { taskId: params.taskId, locatorId: locator.id } } }))];
            return page(items, meta, signature, params, `review-context:${params.taskId}`);
        }
        const locator = c.locators.find(l => l.id === params.locatorId);
        if (!locator)
            throw guidanceError(new Error('Review context locator unavailable'), 'guid-06d7f0f98dff55bb');
        const source = await this.reader(locator);
        if (source.revision !== (locator.revision || locator.commit))
            throw guidanceError(new Error('Context revision is stale'), 'guid-cf1914342165a2fc');
        const lines = source.content.split(/\r?\n/);
        if (locator.endLine > lines.length)
            throw guidanceError(new Error('Context range outside source'), 'guid-e059f9e8a3dd0043');
        const chunks = [];
        for (let line = locator.startLine; line <= locator.endLine;) {
            let end = line, text = lines[line - 1];
            while (end < locator.endLine && end - line < 19 && text.length + lines[end].length + 1 < 1200) {
                text += '\n' + lines[end];
                end++;
            }
            chunks.push({ kind: 'original', locatorId: locator.id, revision: source.revision, startLine: line, endLine: end, text, receipt: '0'.repeat(36) });
            line = end + 1;
        }
        const result = page(chunks, meta, signature, params, `review-original:${params.taskId}`);
        for (const [key, value] of this.receipts)
            if (value.expires < Date.now())
                this.receipts.delete(key);
        while (this.receipts.size + result.items.length > 4096)
            this.receipts.delete(this.receipts.keys().next().value);
        for (const item of result.items) {
            item.receipt = randomUUID();
            this.receipts.set(item.receipt, { account: params.accountId, task: params.taskId, basis: params.basis, locator: locator.id,
                start: item.startLine, end: item.endLine, expires: Date.now() + 30 * 60_000 });
        }
        return result;
    }
    async validate(params) {
        const c = params.context;
        if (!c || !c.locators.length)
            throw guidanceError(new Error('Review requires exact change context evidence'), 'guid-55baafbcf21af8fc');
        const checks = params.checks;
        if (!Array.isArray(checks) || checks.length > 20 || checks.length !== params.criteria.length)
            throw guidanceError(new Error('Structured checks must enumerate all completion criteria'), 'guid-7d900ed87619c0f6');
        if (new Set(checks.map(c => c.criterion)).size !== checks.length || checks.some(c => !params.criteria.includes(c.criterion)))
            throw guidanceError(new Error('Checks must name exact unique criteria'), 'guid-b5208ef049a89dff');
        const tokens = params.receipts;
        if (!Array.isArray(tokens) || tokens.length > 1000)
            throw guidanceError(new Error('Caller-bound context receipts are required'), 'guid-43033c0a2b7e0e93');
        const delivered = tokens.map(token => this.receipts.get(token)).filter(r => r && r.expires >= Date.now() && r.account === params.accountId && r.task === params.taskId && r.basis === params.basis);
        const requiredIds = new Set(c.locators.filter(l => params.approve && (l.required || ['before', 'after'].includes(l.role))).map(l => l.id));
        for (const check of checks)
            for (const id of listField(check.evidenceIds, 'evidenceIds'))
                requiredIds.add(id);
        for (const id of requiredIds) {
            const locator = c.locators.find(l => l.id === id);
            if (!locator)
                throw guidanceError(new Error('Evidence must reference an exact context locator'), 'guid-64aba6e11c5d1ef6');
            for (let line = locator.startLine; line <= locator.endLine; line++)
                if (!delivered.some(r => r.locator === id && r.start <= line && r.end >= line))
                    throw guidanceError(new Error('Required original context range not delivered to this account and version; read context receipts first'), 'guid-c9e49495004b032c');
        }
        if (params.approve && (!c.locators.some(l => l.role === 'before') || !c.locators.some(l => l.role === 'after')))
            throw guidanceError(new Error('Approval requires before and after context'), 'guid-f34480adc98c1c36');
        const matches = (artifact, locator) => artifact.path
            ? locator.path === artifact.path && locator.revision === artifact.revision
            : locator.repository === artifact.repository && locator.commit === artifact.commit;
        const after = c.locators.filter(l => l.role === 'after' && (!params.artifacts?.length || params.artifacts.some(a => matches(a, l))));
        if (params.approve)
            for (const artifact of params.artifacts || []) {
                if (!after.some(l => matches(artifact, l)) || artifact.files?.some(file => !after.some(l => matches(artifact, l) && l.file === file)))
                    throw guidanceError(new Error('Every actual artifact and declared file requires its exact after revision in delivered change context'), 'guid-a5a9c9162c99ef5a');
            }
        const identities = new Map(), originals = new Map();
        if (params.approve)
            for (const locator of c.locators.filter(l => ['before', 'after'].includes(l.role))) {
                const source = await this.reader(locator);
                if (source.revision !== (locator.revision || locator.commit))
                    throw guidanceError(new Error('Before/after source revision changed'), 'guid-ed8ea70d98b92e99');
                originals.set(locator.id, source.content.replaceAll('\r\n', '\n'));
                const workId = source.sourceWorkId;
                if (locator.path && typeof workId === 'string' && workId.trim() && workId.length <= 160)
                    identities.set(locator.id, `note:${workId.trim()}`);
                if (!locator.path)
                    identities.set(locator.id, `git:${locator.repository}\0${locator.file}`);
            }
        const beforeMatches = (before, after) => before.role === 'before'
            && identities.has(before.id) && identities.get(before.id) === identities.get(after.id)
            && (before.revision || before.commit) !== (after.revision || after.commit);
        if (params.approve)
            for (const current of after) {
                const before = c.locators.filter(l => beforeMatches(l, current));
                if (!before.length)
                    throw guidanceError(new Error('Actual artifact needs a before snapshot of the same source work or Git repository/file with a different exact revision'), 'guid-6f7292528241ede8');
                // A conservative enclosing changed-line window: reading only unchanged
                // headers cannot qualify as reading the change. Large spans require a
                // smaller task/context rather than silently omitting changed regions.
                const coversChange = before.some(previous => {
                    const oldLines = originals.get(previous.id).split('\n'), newLines = originals.get(current.id).split('\n');
                    let prefix = 0, suffix = 0;
                    while (prefix < Math.min(oldLines.length, newLines.length) && oldLines[prefix] === newLines[prefix])
                        prefix++;
                    while (suffix < Math.min(oldLines.length, newLines.length) - prefix && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1])
                        suffix++;
                    const covered = (kind, reference, start, end) => {
                        for (let line = start; line <= end; line++)
                            if (!c.locators.some(l => l.role === kind && identities.get(l.id) === identities.get(reference.id)
                                && (l.revision || l.commit) === (reference.revision || reference.commit) && l.startLine <= line && l.endLine >= line))
                                return false;
                        return true;
                    };
                    return covered('before', previous, prefix + 1, oldLines.length - suffix) && covered('after', current, prefix + 1, newLines.length - suffix);
                });
                if (!coversChange)
                    throw guidanceError(new Error('Delivered before/after ranges must cover the actual changed-line window; expand ranges or split the change'), 'guid-bb659ba3c44a0448');
            }
        if (params.approve && (c.unverified.length || c.dissent.length))
            throw guidanceError(new Error('Unverified items or unresolved dissent require resolution or explicit host override'), 'guid-b123495741f8299a');
        const normalized = [];
        let observedTests = 0;
        for (const raw of checks) {
            const check = object(raw, ['criterion', 'verdict', 'rationale', 'evidenceIds', 'missingChecks', 'tests'], 'review check');
            if (!['pass', 'fail', 'unknown', 'not_applicable'].includes(check.verdict))
                throw guidanceError(new Error('Invalid criterion verdict'), 'guid-9676f5f1b277a7ec');
            const mandatory = !params.policy.optionalCriteria?.includes(check.criterion);
            const missingChecks = listField(check.missingChecks, 'missingChecks');
            if (params.approve && ((mandatory && check.verdict !== 'pass') || check.verdict === 'fail' || missingChecks.length))
                throw guidanceError(new Error('Mandatory criterion requires pass with no missing checks'), 'guid-5e3397108239f253');
            const rationale = textField(check.rationale, 'rationale', 1000, true), evidenceIds = listField(check.evidenceIds, 'evidenceIds');
            if (check.verdict === 'pass' && !evidenceIds.length)
                throw guidanceError(new Error('Passing criterion requires exact evidence'), 'guid-914f58e1b582cf0b');
            if (params.approve && mandatory && (!after.some(l => evidenceIds.includes(l.id)) || after.filter(l => evidenceIds.includes(l.id)).some(current => !c.locators.some(l => evidenceIds.includes(l.id) && beforeMatches(l, current)))))
                throw guidanceError(new Error('Mandatory checks must cite paired before and actual artifact after evidence'), 'guid-998086752f4d5071');
            if (!Array.isArray(check.tests) || check.tests.length > 20)
                throw guidanceError(new Error('Tests must be an explicit bounded array'), 'guid-758b944988e0d723');
            if (params.approve && mandatory && !check.tests.length)
                throw guidanceError(new Error('Required criterion needs change-specific verification tests'), 'guid-dad2fb962500f5c3');
            const tests = [];
            for (const value of check.tests) {
                const t = object(value, ['locatorId', 'snapshot', 'environment', 'result', 'missingChecks', 'executionId'], 'review test');
                const test = { locatorId: textField(t.locatorId, 'test locator', 64, true), snapshot: textField(t.snapshot, 'test snapshot', 128, true),
                    environment: textField(t.environment, 'test environment', 500, true), result: t.result, missingChecks: listField(t.missingChecks, 'test missingChecks'),
                    ...(t.executionId !== undefined && { executionId: textField(t.executionId, 'executionId', 128, true) }) };
                const locator = c.locators.find(l => l.id === test.locatorId && l.role === 'test');
                if (!locator || !evidenceIds.includes(locator.id))
                    throw guidanceError(new Error('Test must reference delivered test evidence for this criterion'), 'guid-db0e84074268a171');
                if (!after.some(l => evidenceIds.includes(l.id) && (l.revision || l.commit) === test.snapshot))
                    throw guidanceError(new Error('Test snapshot must match the actual artifact after revision cited by this criterion'), 'guid-2a407186cd33160d');
                if (!['pass', 'fail', 'unknown'].includes(test.result) || (params.approve && (test.result !== 'pass' || test.missingChecks.length)))
                    throw guidanceError(new Error('Required test is failed, unknown or missing checks'), 'guid-81d90a850a9fc186');
                if (params.approve && params.policy.requireHostExecution && (!test.executionId || !await this.verifyExecution?.(test.executionId, { artifactFingerprint: params.basis, criterion: check.criterion, locator, test })))
                    throw guidanceError(new Error('Host-observed execution unavailable or mismatched; review remains pending'), 'guid-d54905e959448a8f');
                if (params.approve && params.policy.requireHostExecution)
                    observedTests++;
                tests.push(test);
            }
            normalized.push({ criterion: check.criterion, verdict: check.verdict, rationale, evidenceIds, missingChecks, tests });
        }
        if (params.approve && params.policy.requireHostExecution && !observedTests)
            throw guidanceError(new Error('Required host-observed execution unavailable; review remains pending'), 'guid-e1add7d107d9b884');
        return { checks: normalized, execution_evidence: observedTests ? 'host_observed' : normalized.some(c => c.tests.length) ? 'self_reported' : 'unavailable',
            context_delivery: { account_id: params.accountId, fingerprint: params.basis, locator_ids: [...requiredIds] } };
    }
}
/** Never let a valid large review become an indivisible pagination barrier. */
export function reviewPacketItems(review) {
    if (review.contract !== 2)
        return [{ kind: 'review', ...review }];
    const items = [{ kind: 'review', ...Object.fromEntries(['contract', 'decision', 'fingerprint', 'account_id', 'reason', 'at', 'verification_level', 'execution_evidence']
                .filter(key => review[key] !== undefined).map(key => [key, typeof review[key] === 'string' ? review[key].slice(0, key === 'reason' ? 500 : 128) : review[key]])) }];
    for (const check of (review.checks || []).slice(0, 20)) {
        items.push({ kind: 'reviewCriterion', criterion: check.criterion, verdict: check.verdict, rationale: check.rationale });
        for (const id of (check.evidenceIds || []).slice(0, 20))
            items.push({ kind: 'reviewEvidence', criterion: check.criterion, locatorId: id });
        for (const text of (check.missingChecks || []).slice(0, 20))
            items.push({ kind: 'reviewMissingCheck', criterion: check.criterion, text });
        for (const test of (check.tests || []).slice(0, 20)) {
            const { missingChecks: _missing, ...fields } = test;
            items.push({ kind: 'reviewTest', criterion: check.criterion, ...fields });
            for (const text of (test.missingChecks || []).slice(0, 20))
                items.push({ kind: 'reviewMissingTestCheck', criterion: check.criterion, locatorId: test.locatorId, text });
        }
    }
    return items;
}
