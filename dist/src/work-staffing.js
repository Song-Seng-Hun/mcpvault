import { guidanceError } from './guidance-runtime.js';
const REVIEW = 'independent_review';
const TIERS = ['unknown', 'economical', 'standard', 'frontier'];
// At most 21 advisory charges accumulate. Allow only relative rounding error,
// including decimal costs such as 0.1 + 0.1 + 0.1; a zero budget stays zero.
const withinBudget = (amount, budget) => amount <= budget
    || (Number.isFinite(amount) && amount - budget <= Number.EPSILON * 32 * Math.max(Math.abs(amount), Math.abs(budget)));
const DEFAULTS = {
    code: ['implementation', 'change-impact', 'test'],
    research: ['source', 'counterpoint'],
    writing: ['language', 'continuity'],
    planning: ['constraints', 'feasibility', 'risk'],
    bookkeeping: ['bookkeeping'],
};
/**
 * Pure, bounded advisory allocation; never establishes access or approves work.
 * Caller must supply every author/requester/assignee account and only visible
 * assignments/profiles. Missing workload means zero, as supplied by the host.
 * active defaults to true. Inactive verified assignments are role history only.
 * Recommendations charge cost per role; sequential hats consume one task WIP
 * slot per account. Existing assignments have already consumed their WIP/cost.
 * Missing family/version/host verification cannot establish new availability.
 */
export function recommendStaffing(input) {
    validate(input);
    const bookkeeping = input.taskType === 'bookkeeping';
    const deterministic = bookkeeping && input.deterministicAvailable === true;
    // Read review intent before deterministic handling suppresses non-review hats.
    const explicitReview = input.requiredPerspectives?.includes(REVIEW) === true;
    const independentRequired = input.workKind !== 'general' || (bookkeeping && explicitReview);
    const needsReview = !bookkeeping || independentRequired;
    const eligible = new Set(input.eligibleAccountIds);
    // All supplied profiles are visible context. Only the separately filtered
    // pool may receive recommendations; author identity is not an access grant.
    const profiles = new Map(input.candidates.map(p => [p.accountId, p]));
    const selectable = input.candidates.filter(p => eligible.has(p.accountId));
    const active = input.currentAssignments.filter(a => a.active !== false);
    const present = new Set(active.map(a => a.accountId));
    const owners = new Set([...input.authorAccountIds, ...(input.assigneeAccountIds ?? []),
        ...active.filter(a => a.perspective !== REVIEW).map(a => a.accountId)]);
    const excludedReviewers = new Set([...owners, ...(input.requesterAccountIds ?? [])]);
    // Existing independent reviewers remain reserved even when no new review is
    // requested; recommending them as authors would invalidate the retained row.
    const reservedReviewers = new Set(active.filter(a => a.perspective === REVIEW && !excludedReviewers.has(a.accountId)).map(a => a.accountId));
    const workload = (id) => Object.hasOwn(input.workload, id) ? input.workload[id] : 0;
    const required = deterministic ? [] : [...new Set(input.requiredPerspectives ?? [
            ...DEFAULTS[input.taskType], ...(input.taskType === 'writing' && input.factualVerification ? ['factual-verification'] : []),
        ])].filter(p => p !== REVIEW);
    const result = {
        advisory: true, rows: [], unfilled: [],
        ...(bookkeeping ? { execution: { mode: deterministic ? 'deterministic' : 'local_llm', llmRequired: !deterministic || needsReview } } : {}),
        explanations: ['Family orders are configurable user preferences, not empirical rankings or permissions.',
            'Recommendations do not constitute approval or evidence of completed verification.'],
        summary: { required: required.length + Number(needsReview), covered: 0, recommended: 0, unfilled: 0, estimatedCost: 0, unknownCost: false },
    };
    const covered = new Set();
    const spent = new Map();
    const proposed = new Set();
    const explanations = new Set(result.explanations);
    if (bookkeeping)
        explanations.add('Bookkeeping uses deterministic code when the host confirms coverage; otherwise only qualified host-verified local LLMs are recommended, with no remote fallback.');
    const family = (p) => p?.hostVerified && p.family && p.family.toLowerCase() !== 'unknown' ? p.family.toLowerCase() : null;
    const known = (p) => Boolean(p?.hostVerified && family(p) && p.version && p.version.toLowerCase() !== 'unknown');
    const localBookkeeper = (p) => known(p) && p.executionLocality === 'local' && p.bookkeepingSuitable === true;
    const qualifies = (p) => {
        if (!known(p))
            return false;
        if (bookkeeping && (!eligible.has(p.accountId) || !localBookkeeper(p)))
            return false;
        if (!(input.requiredTools ?? []).every(tool => p.tools.includes(tool)))
            return false;
        if (!(input.requiredCapabilities ?? []).every(capability => p.capabilities.includes(capability)))
            return false;
        if (TIERS.indexOf(p.tier) < TIERS.indexOf(input.minimumTier ?? 'unknown'))
            return false;
        if (!present.has(p.accountId) && !proposed.has(p.accountId) && workload(p.accountId) >= input.personalWipLimit)
            return false;
        if ((input.budget !== undefined || p.availableBudget !== undefined) && p.cost === undefined)
            return false;
        const cost = p.cost ?? 0;
        if (input.budget !== undefined && !withinBudget(result.summary.estimatedCost + cost, input.budget))
            return false;
        return p.availableBudget === undefined || withinBudget((spent.get(p.accountId) ?? 0) + cost, p.availableBudget);
    };
    for (const assignment of active) {
        const p = profiles.get(assignment.accountId);
        const independent = assignment.perspective === REVIEW && !excludedReviewers.has(assignment.accountId);
        const currentCoverage = !bookkeeping || Boolean(p && qualifies(p));
        result.rows.push({
            accountId: assignment.accountId, perspective: assignment.perspective,
            family: family(p), tier: p?.hostVerified ? p.tier : 'unknown', source: 'existing',
            verification: independent ? 'independent_review' : assignment.verified ? 'verified' : 'declared',
            reasons: [!currentCoverage
                    ? 'Existing bookkeeping ownership is history only; current local eligibility or qualifications are not satisfied.'
                    : 'Existing ownership is preserved; this does not revalidate current eligibility or execution availability.'],
        });
        if (currentCoverage && (assignment.perspective !== REVIEW || independent))
            covered.add(assignment.perspective);
        if (!known(p))
            explanations.add('Some existing ownership has unknown execution metadata; verify the host before new work.');
        if (assignment.perspective === REVIEW && !independent)
            explanations.add('An existing review assignment is not independent of all author/requester/assignee accounts.');
    }
    const costOrder = (a, b) => (a.cost ?? Number.MAX_SAFE_INTEGER) - (b.cost ?? Number.MAX_SAFE_INTEGER);
    const loadOrder = (a, b) => workload(a.accountId) - workload(b.accountId)
        || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0);
    const pick = (perspective, independent, self = false, remainingEssentials = 0) => {
        let pool = selectable.filter(p => qualifies(p)
            && (!independent || !excludedReviewers.has(p.accountId)) && (!self || owners.has(p.accountId))
            && (perspective === REVIEW || !reservedReviewers.has(p.accountId)));
        const order = (Object.hasOwn(input.preferences ?? {}, perspective) ? input.preferences?.[perspective] : undefined)
            ?? [];
        const preference = (p) => {
            const index = order.findIndex(f => f.toLowerCase() === family(p));
            return index < 0 ? order.length : index;
        };
        // Ordinary bookkeeping needs only the cheapest qualified local for each
        // requested hat, with explicit preferences breaking cost ties. Skip all
        // prospective capacity/reviewer reservations and history/diversity ranking.
        if (bookkeeping && !needsReview)
            return pool.sort((a, b) => costOrder(a, b)
                || preference(a) - preference(b) || loadOrder(a, b))[0];
        if (perspective !== REVIEW && pool.length > 1) {
            // All essential perspectives share the same qualification requirements,
            // and sequential hats use one WIP slot. After each possible next choice,
            // cheapest-first therefore measures affordable remaining coverage exactly
            // under these task-level constraints. Reserving each possible independent
            // reviewer adds a bounded second comparison, never recursive combinations:
            // <=100 choices x 101 reservations x (100 profiles + 20 hats) per role.
            // Missing cost is unconstrained only when qualifies allowed no budget.
            const cost = (p) => p.cost ?? 0;
            const ceiling = input.budget ?? Infinity;
            const cheapest = [...pool].sort((a, b) => cost(a) - cost(b));
            const affordableRemainder = (selected, reviewer) => {
                let total = result.summary.estimatedCost + cost(selected) + (reviewer ? cost(reviewer) : 0);
                if (!withinBudget(total, ceiling))
                    return -1;
                let filled = 0;
                for (const candidate of cheapest) {
                    // The reserved account cannot also author any remaining perspective.
                    if (candidate.accountId === reviewer?.accountId)
                        continue;
                    let accountCost = (spent.get(candidate.accountId) ?? 0) + (candidate.accountId === selected.accountId ? cost(selected) : 0);
                    while (filled < remainingEssentials && withinBudget(total + cost(candidate), ceiling)
                        && (candidate.availableBudget === undefined || withinBudget(accountCost + cost(candidate), candidate.availableBudget))) {
                        filled++;
                        total += cost(candidate);
                        accountCost += cost(candidate);
                    }
                    if (filled === remainingEssentials)
                        break;
                }
                return filled;
            };
            const capacity = new Map(pool.map(p => [p.accountId, affordableRemainder(p)]));
            const best = Math.max(...capacity.values());
            const affordable = pool.filter(p => capacity.get(p.accountId) === best);
            if (affordable.length < pool.length)
                explanations.add('Budget is reserved for affordable essential coverage before ownership reuse, diversity or role preference.');
            pool = affordable;
            if (!covered.has(REVIEW)) {
                const reviewers = selectable.filter(p => qualifies(p) && !excludedReviewers.has(p.accountId));
                const reviewable = pool.filter(p => reviewers.some(reviewer => reviewer.accountId !== p.accountId
                    && affordableRemainder(p, reviewer) === best));
                if (reviewable.length) {
                    if (reviewable.length < pool.length)
                        explanations.add('Feasible independent review is preserved after maximum essential coverage and before staffing preferences.');
                    pool = reviewable;
                }
            }
        }
        // A qualified current owner can take sequential hats before asking the host
        // for additional staff. This also leaves available independent reviewers.
        if (!bookkeeping && !independent && !self) {
            const reuse = pool.filter(p => owners.has(p.accountId));
            if (reuse.length)
                pool = reuse;
        }
        const usedFamilies = new Set([...owners].map(id => family(profiles.get(id))).filter(f => f !== null));
        const usedTiers = new Set([...owners].flatMap(id => {
            const p = profiles.get(id);
            return p?.hostVerified && p.tier !== 'unknown' ? [p.tier] : [];
        }));
        const history = (p) => input.currentAssignments.some(a => a.accountId === p.accountId && a.perspective === perspective && a.verified === true) ? 0 : 1;
        const diversity = (p) => usedFamilies.has(family(p)) ? 1 : 0;
        // A different known tier contributes secondary diversity, with no ordering
        // by size. Unknown tier earns no diversity credit; minimum tier gates above.
        const tierDiversity = (p) => usedTiers.size && p.tier !== 'unknown' && !usedTiers.has(p.tier) ? 0 : 1;
        // Coverage and independence are already reserved above; bookkeeping cost
        // takes precedence over ownership, diversity, history and family preference.
        pool.sort((a, b) => (bookkeeping ? costOrder(a, b) : 0)
            || diversity(a) - diversity(b) || tierDiversity(a) - tierDiversity(b)
            || preference(a) - preference(b) || history(a) - history(b)
            || costOrder(a, b)
            || loadOrder(a, b));
        const selected = pool[0];
        if (selected && usedFamilies.size && diversity(selected))
            explanations.add('Family diversity is limited by qualified availability or preserved sequential ownership.');
        return selected;
    };
    const add = (perspective, p, self = false) => {
        const cost = p.cost ?? 0;
        result.summary.estimatedCost += cost;
        result.summary.unknownCost ||= p.cost === undefined;
        spent.set(p.accountId, (spent.get(p.accountId) ?? 0) + cost);
        proposed.add(p.accountId);
        result.rows.push({ perspective, accountId: p.accountId, family: family(p), tier: p.tier,
            source: 'recommendation', verification: self ? 'self_verified' : perspective === REVIEW ? 'independent_review' : 'declared',
            reasons: [self ? 'Ordinary work may use explicit self-verification; this is not independent review.'
                    : perspective === REVIEW ? 'Different account from every supplied author, requester, assignee and proposed essential owner.'
                        : 'Qualified essential perspective; sequential hats are advisory and require host coordination.'],
        });
        if (perspective !== REVIEW) {
            owners.add(p.accountId);
            excludedReviewers.add(p.accountId);
        }
    };
    const wait = (perspective) => {
        const missingHost = [...eligible].some(id => !known(profiles.get(id)));
        result.unfilled.push({ perspective, reason: perspective === REVIEW && independentRequired
                ? 'independent_review_required' : bookkeeping
                ? selectable.some(localBookkeeper) ? 'no_qualified_candidate' : 'no_verified_local_candidate'
                : missingHost ? 'waiting_host_verification' : 'no_qualified_candidate' });
    };
    let remainingEssentials = required.filter(p => !covered.has(p)).length;
    for (const perspective of required) {
        if (covered.has(perspective)) {
            result.summary.covered++;
            continue;
        }
        remainingEssentials--;
        const p = pick(perspective, false, false, remainingEssentials);
        if (p)
            add(perspective, p);
        else
            wait(perspective);
    }
    if (needsReview && covered.has(REVIEW))
        result.summary.covered++;
    else if (needsReview) {
        const reviewer = pick(REVIEW, true);
        const self = !reviewer && !independentRequired ? pick(REVIEW, false, true) : undefined;
        if (reviewer || self)
            add(REVIEW, (reviewer ?? self), Boolean(self));
        else
            wait(REVIEW);
    }
    result.summary.recommended = result.rows.filter(r => r.source === 'recommendation').length;
    result.summary.unfilled = result.unfilled.length;
    result.explanations = [...explanations];
    return result;
}
// Bounds apply before selection, including trusted host inputs, to avoid a
// malformed sidecar request producing an unbounded response or sort workload.
function validate(input) {
    const object = (value, keys) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
            throw guidanceError(new Error('Staffing expects plain objects'), 'guid-ca5f53f498471f16');
        const record = value;
        if (keys && Object.keys(record).some(k => !keys.includes(k)))
            throw guidanceError(new Error('Unknown staffing field'), 'guid-2ab84d9fc5a09972');
        return record;
    };
    const text = (value, account = false) => {
        if (typeof value !== 'string' || !value || value.length > 128 || value !== value.trim()
            || /[\x00-\x1f\x7f]/.test(value) || (account && !/^[a-z0-9][a-z0-9._:-]*$/.test(value)))
            throw guidanceError(new Error('Invalid staffing text or account ID'), 'guid-9133b5864ff94240');
    };
    const list = (value, max) => {
        if (!Array.isArray(value) || value.length > max)
            throw guidanceError(new Error(`Staffing array exceeds ${max} or is invalid`), 'guid-6d01129e5a54dce3');
        return value;
    };
    const strings = (value, max, account = false) => { for (const item of list(value, max))
        text(item, account); };
    const number = (value, integer = false) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9 || (integer && !Number.isSafeInteger(value)))
            throw guidanceError(new Error('Invalid staffing number'), 'guid-0f52372ca59b4bde');
    };
    const boolean = (value) => { if (typeof value !== 'boolean')
        throw guidanceError(new Error('Invalid staffing boolean'), 'guid-182cd19d775ace25'); };
    const tier = (value) => { if (!TIERS.includes(value))
        throw guidanceError(new Error('Invalid execution tier'), 'guid-c83c89c3c52cde8e'); };
    object(input, ['candidates', 'eligibleAccountIds', 'taskType', 'factualVerification', 'requiredPerspectives', 'workKind',
        'authorAccountIds', 'requesterAccountIds', 'assigneeAccountIds', 'currentAssignments', 'workload', 'personalWipLimit',
        'requiredTools', 'requiredCapabilities', 'minimumTier', 'budget', 'preferences', 'deterministicAvailable']);
    if (!['code', 'research', 'writing', 'planning', 'bookkeeping'].includes(input.taskType)
        || (input.deterministicAvailable === true && input.taskType !== 'bookkeeping'))
        throw guidanceError(new Error('Invalid staffing task type'), 'guid-a79782fbd9523683');
    if (!['general', 'security', 'permissions', 'shared_policy', 'destructive'].includes(input.workKind))
        throw guidanceError(new Error('Invalid work kind'), 'guid-cc0e1af0c83477e5');
    number(input.personalWipLimit, true);
    if (input.personalWipLimit < 1)
        throw guidanceError(new Error('personalWipLimit must be positive'), 'guid-897f177242ef7df0');
    strings(input.eligibleAccountIds, 100, true);
    strings(input.authorAccountIds, 100, true);
    for (const key of ['requesterAccountIds', 'assigneeAccountIds'])
        if (input[key] !== undefined)
            strings(input[key], 100, true);
    for (const key of ['requiredPerspectives', 'requiredTools', 'requiredCapabilities'])
        if (input[key] !== undefined)
            strings(input[key], 20);
    if (input.factualVerification !== undefined)
        boolean(input.factualVerification);
    if (input.deterministicAvailable !== undefined)
        boolean(input.deterministicAvailable);
    if (input.minimumTier !== undefined)
        tier(input.minimumTier);
    if (input.budget !== undefined)
        number(input.budget);
    const ids = new Set();
    for (const candidate of list(input.candidates, 100)) {
        const p = object(candidate, ['accountId', 'provider', 'family', 'version', 'reasoning', 'tier', 'tools', 'capabilities', 'hostVerified', 'availableBudget', 'cost', 'executionLocality', 'bookkeepingSuitable']);
        text(p.accountId, true);
        if (ids.has(p.accountId))
            throw guidanceError(new Error('Duplicate execution account profile'), 'guid-29b2a5107462d753');
        ids.add(p.accountId);
        for (const key of ['provider', 'family', 'version', 'reasoning'])
            if (p[key] !== undefined)
                text(p[key]);
        tier(p.tier);
        boolean(p.hostVerified);
        if (p.executionLocality !== undefined && !['local', 'remote', 'unknown'].includes(p.executionLocality))
            throw guidanceError(new Error('Unknown staffing field'), 'guid-2ab84d9fc5a09972');
        if (p.bookkeepingSuitable !== undefined)
            boolean(p.bookkeepingSuitable);
        strings(p.tools, 50);
        strings(p.capabilities, 50);
        for (const key of ['availableBudget', 'cost'])
            if (p[key] !== undefined)
                number(p[key]);
    }
    for (const assignment of list(input.currentAssignments, 100)) {
        const a = object(assignment, ['accountId', 'perspective', 'active', 'verified']);
        text(a.accountId, true);
        text(a.perspective);
        if (a.active !== undefined)
            boolean(a.active);
        if (a.verified !== undefined)
            boolean(a.verified);
    }
    const workload = object(input.workload);
    if (Object.keys(workload).length > 100)
        throw guidanceError(new Error('Too many workload entries'), 'guid-4984f4f20711d99f');
    for (const [id, count] of Object.entries(workload)) {
        text(id, true);
        number(count, true);
    }
    if (input.preferences !== undefined) {
        const preferences = object(input.preferences);
        if (Object.keys(preferences).length > 40)
            throw guidanceError(new Error('Too many staffing preferences'), 'guid-a4d2276a8264e783');
        for (const [role, families] of Object.entries(preferences)) {
            text(role);
            strings(families, 20);
        }
    }
}
