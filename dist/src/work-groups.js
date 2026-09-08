import { guidanceError, guidanceText } from './guidance-runtime.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { normalizeScopeId } from './scopes.js';
import { isModerationHidden } from './moderation-policy.js';
import { coordinate, fingerprint, integer, listField, textField, page } from './work-model.js';
const MAX_MEMBERS = 100;
const RECEIPTS = 16;
const GROUP_OPS = new Set(['read', 'create', 'update', 'join', 'leave', 'archive']);
const groupPath = (id) => `Community/Groups/${normalizeScopeId(id, 'groupId')}.md`;
const timestamp = () => new Date().toISOString();
export class WorkGroupService {
    fs;
    refs;
    auth;
    options;
    access = new ScopeAccessPolicy();
    constructor(fs, refs, auth, options = {}) {
        this.fs = fs;
        this.refs = refs;
        this.auth = auth;
        this.options = options;
    }
    async group(params) {
        const op = params.op || 'read';
        if (!GROUP_OPS.has(op))
            throw guidanceError(new Error('Unsupported work group operation'), 'guid-3d950e71da1eecb7');
        const id = normalizeScopeId(params.groupId, 'groupId');
        const path = groupPath(id);
        if (op === 'read')
            return this.read(id, params);
        const actor = await this.actor(params.principal);
        return coordinate(() => this.mutate(op, id, path, params, actor));
    }
    async actor(principal) {
        if (!principal)
            throw guidanceError(new Error('Authenticated account is required for group work'), 'guid-af646ab24dd428f4');
        const current = (await this.auth.listPrincipals()).find(p => p.accountId === principal.accountId);
        if (!current || current.modelId !== principal.modelId || current.agentId !== principal.agentId || current.role !== principal.role
            || (principal.commandCenterId && principal.commandCenterId !== this.access.getCommandCenterId())) {
            throw guidanceError(new Error('Authenticated account is unavailable in this scope'), 'guid-20a48e6c5f1ac92e');
        }
        if (!this.auth.hasCapability(current, 'task') || !this.auth.hasCapability(principal, 'task') || current.role !== 'agent') {
            throw guidanceError(new Error('A registered task-capable agent is required for group membership'), 'guid-8f6df4611211dd83');
        }
        await this.options.assertActor?.(principal);
        return principal;
    }
    async visible(id) {
        const path = groupPath(id);
        if (!this.access.canAccessPhysicalPath(path))
            throw guidanceError(new Error('Work group is unavailable'), 'guid-1f0f07ea12fa5551');
        let note;
        try {
            note = await this.fs.readNote(path);
        }
        catch {
            throw guidanceError(new Error('Work group is unavailable'), 'guid-1f0f07ea12fa5551');
        }
        if (isModerationHidden(note.frontmatter) || note.frontmatter.mcpvault_type !== 'work_group' || note.frontmatter.group_id !== id) {
            throw guidanceError(new Error('Work group is unavailable'), 'guid-1f0f07ea12fa5551');
        }
        this.validateRecord(note.frontmatter);
        return note;
    }
    validateRecord(fm) {
        let owner;
        try {
            owner = normalizeScopeId(fm.owner_account_id, 'owner_account_id');
        }
        catch {
            throw guidanceError(new Error('Work group owner is malformed'), 'guid-d6b81588f96022b4');
        }
        if (!Array.isArray(fm.members) || fm.members.length > MAX_MEMBERS || !fm.members.every((m) => typeof m === 'string' && m.trim())) {
            throw guidanceError(new Error('Work group membership is malformed'), 'guid-fa180292c88ebaa2');
        }
        let members;
        try {
            members = [...new Set(fm.members.map((m) => normalizeScopeId(m, 'member_account_id')))];
        }
        catch {
            throw guidanceError(new Error('Work group membership is malformed'), 'guid-fa180292c88ebaa2');
        }
        if (fm.status !== 'active' && fm.status !== 'archived')
            throw guidanceError(new Error('Work group status is malformed'), 'guid-4edd2c05fa0b213b');
        return { owner, members };
    }
    async read(id, params) {
        const note = await this.visible(id);
        const maximum = integer(params.maxChars, 4000, 12000, 'maxChars');
        if (params.expectedRevision && params.expectedRevision !== note.revision)
            throw guidanceError(new Error('Group revision changed; read the group again'), 'guid-1cb60897a9f36045');
        if (params.field !== undefined) {
            if (!['members', 'topics', 'references'].includes(params.field))
                throw guidanceError(new Error('Unsupported group field'), 'guid-e98ec37184a27eac');
            const values = params.field === 'references' ? await this.visibleReferences(note.frontmatter) : listField(note.frontmatter[params.field] || [], params.field, params.field === 'members' ? 100 : 20);
            return page(values.map(value => ({ value })), { groupId: id, field: params.field, revision: note.revision }, fingerprint({ revision: note.revision, values }), params, `group:${id}:${params.field}`);
        }
        if (params.cursor)
            throw guidanceError(new Error('Group cursor requires its original field'), 'guid-d9ba8e73916b78b3');
        return this.project(id, note, undefined, maximum);
    }
    async visibleReferences(fm, principal) {
        const resolved = await this.refs.resolve(Array.isArray(fm.references) ? fm.references : [], principal, false, 20, 4000);
        return resolved.map(item => String(item.path));
    }
    async validateReferences(value, path, principal) {
        const references = await this.refs.validateAndNormalize(value, path, principal);
        for (const reference of references) {
            if (!this.access.canAccessPhysicalPath(reference, principal))
                throw guidanceError(new Error('Reference is not visible in the current scope'), 'guid-7f51ca8c14e976ed');
            const note = await this.fs.readNote(reference);
            if (isModerationHidden(note.frontmatter))
                throw guidanceError(new Error('Reference is hidden by moderation'), 'guid-3cbc3fb49e25f257');
        }
        return references;
    }
    async project(id, note, principal, maximum) {
        const normalized = this.validateRecord(note.frontmatter);
        const references = await this.visibleReferences(note.frontmatter, principal);
        const source = { ...note.frontmatter, owner_account_id: normalized.owner, members: normalized.members, references };
        const group = {};
        const omittedFields = [];
        const result = { groupId: id, path: groupPath(id), revision: note.revision, group, truncated: false, omittedFields };
        const fields = ['mcpvault_type', 'group_id', 'title', 'purpose', 'topics', 'references', 'owner_account_id', 'members', 'status', 'created_at', 'updated_at'];
        for (const key of fields) {
            if (source[key] === undefined)
                continue;
            group[key] = structuredClone(source[key]);
            if (JSON.stringify(result).length > maximum) {
                delete group[key];
                omittedFields.push(key);
                result.truncated = true;
            }
        }
        if (result.truncated) {
            const field = omittedFields.find(key => ['members', 'topics', 'references'].includes(key));
            result.nextAction = field
                ? { tool: 'work.group', arguments: { op: 'read', groupId: id, field, expectedRevision: note.revision, maxChars: maximum } }
                : { tool: 'notes.read', arguments: { path: groupPath(id), maxChars: maximum }, reason: guidanceText('guid-d055c94c93e9fc0a', 'Inspect malformed or oversized authored metadata with bounded note reading.') };
        }
        if (JSON.stringify(result).length > maximum)
            throw guidanceError(new Error('maxChars is too small for the group response envelope'), 'guid-0b2ec45a26ed737e');
        return result;
    }
    request(params, actor, op, id) {
        const requestId = textField(params.requestId, 'requestId', 128, true);
        const payload = { op, groupId: id };
        for (const key of ['title', 'purpose', 'topics', 'references', 'expectedRevision'])
            if (params[key] !== undefined)
                payload[key] = params[key];
        return { requestId, actor: actor.accountId, op, groupId: id, payload: fingerprint(payload) };
    }
    retry(fm, content, request, revision) {
        const found = (Array.isArray(fm.group_receipts) ? fm.group_receipts : []).find((r) => r.requestId === request.requestId && r.actor === request.actor && r.op === request.op);
        if (!found)
            return undefined;
        if (found.payload !== request.payload)
            throw guidanceError(new Error('requestId was already used with a different payload'), 'guid-da844e5a927b4397');
        const { group_receipts: _receipts, ...state } = fm;
        if (found.state !== fingerprint({ frontmatter: state, content }))
            throw guidanceError(new Error('Group receipt cannot be safely replayed after an external Markdown edit'), 'guid-7f41b4577acb4a84');
        return { ...structuredClone(found.result), revision };
    }
    async mutate(op, id, path, params, actor) {
        if (params.references !== undefined && (!Array.isArray(params.references) || params.references.length > 20)) {
            throw guidanceError(new Error('references must be an array of at most 20 paths'), 'guid-37ce160feaaf2f9d');
        }
        if (op === 'create' && params.expectedRevision !== undefined && params.expectedRevision !== 'missing')
            throw guidanceError(new Error('Creation expectedRevision must be missing'), 'guid-685ce53acde90fe4');
        const request = this.request(params, actor, op, id);
        let note;
        try {
            note = await this.visible(id);
        }
        catch (error) {
            if (op !== 'create')
                throw error;
            try {
                note = await this.fs.readNote(path);
            }
            catch {
                note = undefined;
            }
        }
        if (op === 'create') {
            if (note) {
                this.validateRecord(note.frontmatter);
                const retry = this.retry(note.frontmatter, note.content, request, note.revision);
                if (retry)
                    return retry;
                throw guidanceError(new Error('Work group already exists'), 'guid-eaafbc1c56068037');
            }
            const references = await this.validateReferences(params.references, path, actor);
            const fm = {
                mcpvault_type: 'work_group', group_id: id, title: textField(params.title ?? id, 'title', 240, true),
                purpose: textField(params.purpose, 'purpose', 1000), topics: listField(params.topics ?? [], 'topics', 20), references,
                owner_account_id: actor.accountId, members: [actor.accountId], status: 'active', created_at: timestamp(), updated_at: timestamp(),
            };
            await this.project(id, { revision: 'missing', frontmatter: fm, content: '' }, actor, 4000);
            return this.write(path, 'missing', '', fm, request, references, actor, id, params.maxChars);
        }
        if (!note)
            throw guidanceError(new Error('Work group is unavailable'), 'guid-1f0f07ea12fa5551');
        const record = this.validateRecord(note.frontmatter);
        if ((op === 'update' || op === 'archive') && record.owner !== actor.accountId)
            throw guidanceError(new Error('Only the group owner may configure or archive it'), 'guid-c1719f2b1bee9816');
        const retry = this.retry(note.frontmatter, note.content, request, note.revision);
        if (retry)
            return retry;
        if (params.expectedRevision === undefined || params.expectedRevision !== note.revision)
            throw guidanceError(new Error('expectedRevision is required and must match the current group revision'), 'guid-a44ce5035f5842b1');
        const fm = structuredClone(note.frontmatter);
        const members = [...record.members];
        if (op === 'join') {
            if (fm.status === 'archived')
                throw guidanceError(new Error('Archived groups do not accept new members'), 'guid-caab835f1616ebd8');
            if (!members.includes(actor.accountId)) {
                if (members.length >= MAX_MEMBERS)
                    throw guidanceError(new Error('Work group membership limit reached'), 'guid-dbeba60c54b25b18');
                members.push(actor.accountId);
            }
        }
        else if (op === 'leave') {
            const index = members.indexOf(actor.accountId);
            if (index >= 0)
                members.splice(index, 1);
        }
        else if (op === 'update') {
            if (params.title !== undefined)
                fm.title = textField(params.title, 'title', 240, true);
            if (params.purpose !== undefined)
                fm.purpose = textField(params.purpose, 'purpose', 1000);
            if (params.topics !== undefined)
                fm.topics = listField(params.topics, 'topics', 20);
            if (params.references !== undefined)
                fm.references = await this.validateReferences(params.references, path, actor);
        }
        else if (op === 'archive')
            fm.status = 'archived';
        fm.members = members;
        fm.updated_at = timestamp();
        // Departure changes only membership. A missing/hidden historical source
        // must not trap members, nor be normalized, copied into output or deleted.
        const references = op === 'leave' ? [] : await this.validateReferences(fm.references, path, actor);
        if (op !== 'leave')
            fm.references = references;
        return this.write(path, note.revision, note.content, fm, request, references, actor, id, params.maxChars);
    }
    async write(path, expectedRevision, content, fm, request, references, actor, id, maxChars) {
        const guards = [];
        for (const reference of references) {
            if (!this.access.canAccessPhysicalPath(reference, actor) || !this.access.canReferenceFrom(path, reference))
                throw guidanceError(new Error('Reference is not visible in the current scope'), 'guid-7f51ca8c14e976ed');
            const validated = await this.fs.readNote(reference);
            if (isModerationHidden(validated.frontmatter))
                throw guidanceError(new Error('Reference is hidden by moderation'), 'guid-3cbc3fb49e25f257');
            guards.push({ path: reference, expectedRevision: validated.revision });
        }
        const receipts = Array.isArray(fm.group_receipts) ? fm.group_receipts : [];
        const resultEnvelope = () => {
            const result = { groupId: id, path, revision: '0'.repeat(64), requestId: request.requestId, operation: request.op };
            return result;
        };
        const envelope = resultEnvelope();
        if (JSON.stringify(envelope).length > integer(maxChars, 4000, 12000, 'maxChars'))
            throw guidanceError(new Error('maxChars is too small for the mutation receipt'), 'guid-b133f659c637bc49');
        const writeWithReceipt = async () => {
            const { group_receipts: _receipts, ...state } = fm;
            fm.group_receipts = [...receipts.slice(-(RECEIPTS - 1)), { ...request, state: fingerprint({ frontmatter: state, content }), result: envelope }];
            const assertAccess = async () => { await this.actor(actor); };
            const write = guards.length
                ? await this.fs.writeNoteWithRevisionGuardsAndReceipt({ path, content, frontmatter: fm, expectedRevision }, guards, { assertAccess, maxGuards: 20 })
                : await this.fs.writeNoteWithReceipt({ path, content, frontmatter: fm, expectedRevision }, { assertAccess });
            envelope.revision = write.revision;
            return envelope;
        };
        return writeWithReceipt();
    }
}
