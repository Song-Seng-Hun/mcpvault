import { guidanceError, guidanceText } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { jsonPointerNode, pageJsonRead } from './json-read-page.js';
/** Caller must reject mutation replays before dispatch and authorize every read. */
export function readResponseView(response, path, cursor, basis, budget) {
    if (response?.content?.length !== 1 || response.content[0]?.type !== 'text')
        throw guidanceError(Error('Read view requires one JSON text result'), 'guid-18178cbeb279847e');
    const root = JSON.parse(response.content[0].text);
    const node = jsonPointerNode(root, path);
    if (node === undefined)
        throw guidanceError(Error('Read view path is absent from the current authorized result'), 'guid-29db0efdf11db82e');
    const value = pageJsonRead(node, path, { basis, root }, cursor, budget, (resultPage, total, truncated, nextCursor) => ({
        resultPage, total, truncated, partial: Boolean(resultPage.entries) || typeof node === 'string' && typeof resultPage.value !== 'string',
        ...(nextCursor && { nextCursor }),
    }));
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
/** MCP discovery keeps complete schemas; oversized translations use code-owned prose. */
export function boundedToolCatalog(original, localized, cursor, maxBytes = 5000) {
    const fits = (value) => Buffer.byteLength(JSON.stringify(value)) <= maxBytes;
    const tools = original.map((tool, index) => fits({ tools: [localized[index] ?? tool] }) ? localized[index] ?? tool : tool);
    if (cursor === undefined && fits({ tools }))
        return { tools };
    const fingerprint = createHash('sha256').update(JSON.stringify(tools)).digest('hex').slice(0, 32);
    let offset = 0;
    if (cursor !== undefined) {
        try {
            if (typeof cursor !== 'string' || cursor.length > 256)
                throw Error();
            const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
            if (parsed.f !== fingerprint || !Number.isInteger(parsed.o) || parsed.o < 0 || parsed.o >= tools.length)
                throw Error();
            offset = parsed.o;
        }
        catch {
            throw guidanceError(Error('Tool catalog cursor invalid or changed; restart tools/list.'), 'guid-7e1b0937db56865e');
        }
    }
    const page = (count) => ({ tools: tools.slice(offset, offset + count),
        ...(offset + count < tools.length && { nextCursor: Buffer.from(JSON.stringify({ f: fingerprint, o: offset + count })).toString('base64url') }),
    });
    // The final page drops its cursor. Check it before bounded prefixes.
    const remaining = tools.length - offset;
    if (fits(page(remaining)))
        return page(remaining);
    let count = 0;
    while (count + 1 < remaining && fits(page(count + 1)))
        count++;
    if (!count)
        throw guidanceError(Error(`Fixed MCP tool schema cannot fit ${maxBytes} bytes; reduce the code-owned schema.`), 'guid-5bd06777d5cc8a8a');
    return page(count);
}
export function enforceResponseBudget(response, requestedMaxChars, pulseRequest) {
    const maxChars = Number(requestedMaxChars);
    if (!Number.isInteger(maxChars) || maxChars < 1 || !response?.content)
        return response;
    const textBlocks = response.content.filter((block) => block?.type === 'text');
    const totalLength = textBlocks.reduce((total, block) => total + String(block.text || '').length, 0);
    if (totalLength <= maxChars)
        return response;
    let value;
    try {
        value = JSON.parse(String(textBlocks[0]?.text || ''));
    }
    catch {
        value = undefined;
    }
    if (value !== undefined) {
        const minified = JSON.stringify(value);
        if (minified.length <= maxChars)
            return { ...response, content: [{ type: 'text', text: minified }] };
    }
    const compact = compactOverflowValue(value, maxChars, pulseRequest);
    let text = JSON.stringify(compact);
    if (text.length > maxChars)
        text = maxChars >= 2 ? '{"truncated":true}' : '0';
    return {
        ...response,
        content: [{ type: 'text', text }],
    };
}
export function normalizedResponseBudget(value, inputSchema) {
    const maxCharsSchema = (inputSchema?.properties?.maxChars || {});
    // A descriptor may recommend a larger useful projection, but every read
    // endpoint still accepts the shared emergency/tiny response budget. Several
    // service-specific projections intentionally preserve identity and a next
    // action in 512 characters.
    const minimum = 512;
    const maximum = Number.isInteger(Number(maxCharsSchema.maximum)) ? Number(maxCharsSchema.maximum) : 20000;
    const fallback = Number.isInteger(Number(maxCharsSchema.default)) ? Number(maxCharsSchema.default) : 12000;
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
        throw guidanceError(new Error(`maxChars must be an integer between ${minimum} and ${maximum}`), 'guid-5f841d3eacb4f0d2');
    return parsed;
}
function compactOverflowValue(value, maxChars, pulseRequest) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { truncated: true, maxChars };
    }
    const source = value;
    const compact = { truncated: true, maxChars };
    // Error classification is code-owned and must survive editable prose overflow.
    if (typeof source.error === 'string' && /^[a-z0-9_]{1,80}$/.test(source.error))
        compact.error = source.error;
    const executableStringLimit = 1024;
    const compactArguments = (input) => {
        if (input === undefined)
            return { valid: true };
        if (!input || typeof input !== 'object' || Array.isArray(input))
            return { valid: false };
        const entries = Object.entries(input);
        if (entries.length > 8)
            return { valid: false };
        const result = {};
        for (const [key, item] of entries) {
            if (key.length > 80 || /(?:token|password|secret|credential)/i.test(key))
                return { valid: false };
            if (typeof item === 'string') {
                if (item.length > executableStringLimit)
                    return { valid: false };
                result[key] = item;
            }
            else if (typeof item === 'number' && Number.isFinite(item))
                result[key] = item;
            else if (typeof item === 'boolean' || item === null)
                result[key] = item;
            else
                return { valid: false };
        }
        return Object.keys(result).length > 0 ? { valid: true, value: result } : { valid: true };
    };
    const compactAction = (input, depth = 0) => {
        if (!input || typeof input !== 'object' || Array.isArray(input))
            return undefined;
        const action = input;
        const result = {};
        for (const key of ['endpointId', 'tool', 'target', 'followUpTool', 'followUpEndpointId', 'selectedRevision']) {
            if (action[key] === undefined)
                continue;
            if (typeof action[key] !== 'string' || String(action[key]).length > executableStringLimit)
                return undefined;
            result[key] = action[key];
        }
        if (typeof action.reason === 'string')
            result.reason = action.reason.slice(0, 160);
        const args = compactArguments(action.arguments);
        if (!args.valid)
            return undefined;
        if (args.value)
            result.arguments = args.value;
        if (Array.isArray(action.requiredArguments))
            result.requiredArguments = action.requiredArguments.slice(0, 8).map(item => String(item).slice(0, 80));
        if (action.followUpPlan !== undefined) {
            if (depth >= 1)
                return undefined;
            const followUpPlan = compactAction(action.followUpPlan, depth + 1);
            if (followUpPlan)
                result.followUpPlan = followUpPlan;
            else
                result.followUpPlanOmitted = true;
        }
        if (JSON.stringify(result).length <= maxChars)
            return result;
        // Human explanation and missing-field hints are dispensable in the tiny
        // envelope; executable identifiers and arguments are not.
        delete result.reason;
        delete result.requiredArguments;
        if (JSON.stringify(result).length <= maxChars)
            return result;
        if (result.followUpPlan) {
            delete result.followUpPlan;
            result.followUpPlanOmitted = true;
        }
        return JSON.stringify(result).length <= maxChars ? result : undefined;
    };
    const compactLocator = (input) => {
        if (!input || typeof input !== 'object' || Array.isArray(input))
            return undefined;
        const item = input;
        const result = {};
        for (const key of ['path', 'revision', 'stableId', 'sourceType']) {
            if (item[key] === undefined)
                continue;
            if (typeof item[key] !== 'string' || String(item[key]).length > executableStringLimit)
                return undefined;
            result[key] = item[key];
        }
        if (typeof item.title === 'string')
            result.title = item.title.slice(0, 200);
        return result;
    };
    const pulseRetryAction = source.protocol === 'mcpvault-agent-pulse/v1'
        ? {
            tool: 'get_agent_pulse',
            arguments: {
                limit: Number.isInteger(pulseRequest?.limit) && Number(pulseRequest.limit) >= 1 && Number(pulseRequest.limit) <= 20 ? Number(pulseRequest.limit) : 1,
                maxChars: Math.min(12000, Math.max(6000, maxChars * 2)),
                ...(typeof pulseRequest?.skillId === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(pulseRequest.skillId) && { skillId: pulseRequest.skillId }),
                ...(typeof pulseRequest?.hostBusy === 'boolean' && { hostBusy: pulseRequest.hostBusy }),
            },
            reason: guidanceText('guid-c7a4b791d819a87f', 'The exact next action does not fit this response budget. Retry the pulse with the larger bounded budget.'),
        }
        : undefined;
    // Preserve the complete compact handoff route, not only the maintenance
    // action. Dropping it made small-budget clients publish session state.
    if (pulseRetryAction && typeof source.cadence === 'string' && source.cadence.length <= 600)
        compact.cadence = source.cadence;
    for (const key of ['protocol', 'state', 'scope', 'path', 'revision', 'roomId', 'messageId', 'commentId', 'slug', 'total', 'totalMessages', 'nextCursor', 'contextBefore', 'contractFingerprint', 'counterpartFingerprint', 'compatible', 'complete', 'nextSnoozedReviewAt', 'priorityScanTruncated']) {
        const candidate = source[key];
        if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean')
            compact[key] = candidate;
    }
    if (source.counts && typeof source.counts === 'object' && !Array.isArray(source.counts)
        && typeof source.counts.snoozedPriorities === 'number') {
        compact.counts = { snoozedPriorities: source.counts.snoozedPriorities };
    }
    if (source.identity && typeof source.identity === 'object' && !Array.isArray(source.identity)) {
        const identity = source.identity;
        compact.identity = Object.fromEntries(['accountId', 'userId', 'familyId', 'modelId', 'agentId', 'commandCenterId', 'level', 'xp', 'levelLabel'].filter(key => identity[key] !== undefined).map(key => [key, identity[key]]));
    }
    if (source.signals && typeof source.signals === 'object' && !Array.isArray(source.signals))
        compact.signals = source.signals;
    if (pulseRetryAction && source.coverage && typeof source.coverage === 'object' && !Array.isArray(source.coverage))
        compact.coverage = source.coverage;
    if (source.nextAction && typeof source.nextAction === 'object' && !Array.isArray(source.nextAction)) {
        compact.nextAction = compactAction(source.nextAction) || pulseRetryAction;
    }
    if (source.source && typeof source.source === 'object' && !Array.isArray(source.source))
        compact.source = compactLocator(source.source);
    if (source.selected && typeof source.selected === 'object' && !Array.isArray(source.selected))
        compact.selected = compactLocator(source.selected);
    if (Array.isArray(source.workflowRoutes))
        compact.workflowRoutes = source.workflowRoutes.slice(0, 2).map(route => {
            if (!route || typeof route !== 'object')
                return route;
            const item = route;
            return { intent: item.intent, ...compactAction(item) };
        });
    if (source.synthesisPlan && typeof source.synthesisPlan === 'object' && !Array.isArray(source.synthesisPlan)) {
        const plan = source.synthesisPlan;
        compact.synthesisPlan = {
            status: plan.status,
            inputs: Array.isArray(plan.inputs) ? plan.inputs.slice(0, 2).map(compactLocator) : [],
            missingStages: Array.isArray(plan.missingStages) ? plan.missingStages.slice(0, 4) : [],
            nextAction: compactAction(plan.nextAction),
        };
    }
    if (source.curationPlan && typeof source.curationPlan === 'object' && !Array.isArray(source.curationPlan)) {
        const plan = source.curationPlan;
        compact.curationPlan = { selected: compactLocator(plan.selected), inspect: compactAction(plan.inspect), then: compactAction(plan.then) };
    }
    if (source.migrationPreview && typeof source.migrationPreview === 'object' && !Array.isArray(source.migrationPreview)) {
        const preview = source.migrationPreview;
        compact.migrationPreview = Object.fromEntries(['compatible', 'complete', 'counterpartFingerprint', 'blockingIssues', 'warnings', 'nextAction'].filter(key => preview[key] !== undefined).map(key => [key, key === 'nextAction' ? compactAction(preview[key]) : Array.isArray(preview[key]) ? preview[key].slice(0, 3) : preview[key]]));
    }
    if (Array.isArray(source.endpoints)) {
        compact.endpoints = source.endpoints.slice(0, 3).map(endpoint => {
            if (!endpoint || typeof endpoint !== 'object')
                return endpoint;
            const item = endpoint;
            return Object.fromEntries(['endpointId', 'method', 'url', 'available', 'state', 'requires', 'reason', 'schemaOmitted'].filter(key => item[key] !== undefined).map(key => [key, item[key]]));
        });
    }
    if (source.byCode && typeof source.byCode === 'object' && !Array.isArray(source.byCode))
        compact.byCode = source.byCode;
    if (source.typedRelations && typeof source.typedRelations === 'object' && !Array.isArray(source.typedRelations)) {
        const typed = source.typedRelations;
        compact.typedRelations = Object.fromEntries(['unresolved', 'ambiguous', 'self', 'kindMismatches'].flatMap(key => {
            const item = typed[key];
            if (!item || typeof item !== 'object' || Array.isArray(item))
                return [];
            const value = item;
            return [[key, {
                        total: typeof value.total === 'number' ? value.total : 0,
                        items: Array.isArray(value.items) ? value.items.slice(0, 2) : [],
                        truncated: Boolean(value.truncated) || (Array.isArray(value.items) && value.items.length > 2),
                    }]];
        }));
    }
    if (source.conventions && typeof source.conventions === 'object' && !Array.isArray(source.conventions)) {
        const conventions = source.conventions;
        const compactConventions = {};
        for (const key of ['scalar', 'lists', 'nested', 'lifecycle', 'review']) {
            if (typeof conventions[key] === 'string')
                compactConventions[key] = String(conventions[key]).slice(0, 360);
        }
        if (conventions.nativeCompatibility && typeof conventions.nativeCompatibility === 'object' && !Array.isArray(conventions.nativeCompatibility)) {
            const native = conventions.nativeCompatibility;
            compactConventions.nativeCompatibility = {
                safeTypes: Array.isArray(native.safeTypes) ? native.safeTypes.slice(0, 12) : [],
                mcpManagedComplexFields: Array.isArray(native.mcpManagedComplexFields) ? native.mcpManagedComplexFields.slice(0, 12) : [],
                rule: typeof native.rule === 'string' ? String(native.rule).slice(0, 600) : undefined,
            };
        }
        compact.conventions = compactConventions;
    }
    if (Array.isArray(source.issues))
        compact.issues = source.issues.slice(0, 12).map(issue => {
            if (!issue || typeof issue !== 'object')
                return issue;
            const item = issue;
            return Object.fromEntries(['path', 'code', 'severity', 'detail'].filter(key => item[key] !== undefined).map(key => [key, typeof item[key] === 'string' ? String(item[key]).slice(0, 360) : item[key]]));
        });
    if (Array.isArray(source.recommendations))
        compact.recommendations = source.recommendations.slice(0, 8).map(item => String(item).slice(0, 360));
    if (source.quarantine && typeof source.quarantine === 'object' && !Array.isArray(source.quarantine)) {
        const quarantine = source.quarantine;
        compact.quarantine = { total: quarantine.total, truncated: quarantine.truncated, items: Array.isArray(quarantine.items) ? quarantine.items.slice(0, 8) : [] };
    }
    if (JSON.stringify(compact).length <= maxChars)
        return compact;
    if (pulseRetryAction && source.coverage)
        return {
            truncated: true, maxChars, coverageOmitted: true, guidanceOmitted: true,
            nextAction: pulseRetryAction,
        };
    const tiny = { truncated: true, maxChars };
    if (compact.cadence)
        tiny.cadence = compact.cadence;
    for (const key of ['scope', 'path', 'revision', 'contractFingerprint', 'counterpartFingerprint', 'compatible'])
        if (compact[key] !== undefined)
            tiny[key] = compact[key];
    if (compact.nextAction)
        tiny.nextAction = compact.nextAction;
    else if (compact.curationPlan && typeof compact.curationPlan === 'object') {
        const plan = compact.curationPlan;
        tiny.selected = plan.selected;
        tiny.nextAction = plan.inspect;
    }
    else if (compact.synthesisPlan && typeof compact.synthesisPlan === 'object') {
        const plan = compact.synthesisPlan;
        tiny.status = plan.status;
        tiny.nextAction = plan.nextAction;
    }
    if (JSON.stringify(tiny).length <= maxChars)
        return tiny;
    if (pulseRetryAction && typeof source.cadence === 'string')
        return {
            truncated: true, maxChars, guidanceOmitted: true,
            nextAction: { ...pulseRetryAction, reason: guidanceText('guid-8832898f637a8f94', 'Handoff guidance does not fit. Retry this bounded pulse before choosing the next action.') },
        };
    if (pulseRetryAction)
        return { truncated: true, maxChars, nextAction: pulseRetryAction };
    return { truncated: true, maxChars };
}
