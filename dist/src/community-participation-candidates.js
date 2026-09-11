import { guidanceError } from './guidance-runtime.js';
import { isModerationHidden } from './moderation-policy.js';
import { isClosedWorkflowStatus } from './community-status.js';
import { fingerprint } from './work-model.js';
const words = (value) => value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
/** Absence is a fresh bounded source check, independent of seen/ranking/topics.
 * Never interpret a partial, unreadable or changing inventory as empty. */
export async function discussionSnapshot(fs, access, principal) {
    const root = (path) => /^Community\/(Posts|Workshops|Ideas)\/[^/]+\.md$/.test(path);
    const admitted = (path) => root(path) && access.canAccessPhysicalPath(path, principal);
    let changed = false, count = 0, active = false;
    const guards = new Map();
    const dispose = fs.observeNoteChanges(path => { if (root(path.replace(/\\/g, '/')))
        changed = true; });
    try {
        for await (const note of fs.iterateFreshNoteMetadata(admitted, { maxBytes: 64 * 1024, strictMissing: true })) {
            if (++count > 128 || !note.revision)
                return { state: 'unknown' };
            guards.set(note.path, note.revision);
            const fm = note.frontmatter;
            if (isModerationHidden(fm) || fm.content_status === 'deleted')
                continue;
            if (fm.mcpvault_type === 'blog_post' && fm.status === 'published' && !isClosedWorkflowStatus(fm.workflow_status)
                && note.path !== 'Community/Posts/self-introductions.md' && fm.post_id !== 'self-introductions')
                active = true;
            if (fm.mcpvault_type === 'workshop' && fm.status === 'open')
                active = true;
            if (fm.mcpvault_type === 'idea' && !['rejected', 'parked', 'implemented', 'promoted'].includes(String(fm.status)))
                active = true;
        }
        for (const [path, revision] of guards)
            if (!admitted(path) || await fs.readNoteRevision(path, 64 * 1024) !== revision)
                return { state: 'unknown' };
        if (changed || [...guards.keys()].some(path => !admitted(path)))
            return { state: 'unknown' };
        return { state: active ? 'active' : 'empty' };
    }
    catch {
        return { state: 'unknown' };
    }
    finally {
        dispose();
    }
}
/** Completed tasks remain readable for explicit result confirmation. */
export function isParticipationTask(path, frontmatter) {
    const id = /^Community\/Tasks\/([a-z0-9][a-z0-9._-]*)\.md$/.exec(path)?.[1];
    return Boolean(id && frontmatter.mcpvault_type === 'agent_task' && frontmatter.task_id === id
        && ['proposed', 'accepted', 'in_progress', 'blocked', 'in_review', 'completed'].includes(String(frontmatter.status)));
}
export function matchesParticipationTopic(frontmatter, topic) {
    const canonical = topic.normalize('NFKC').trim().toLowerCase();
    if (Array.isArray(frontmatter.tags) && frontmatter.tags.some(tag => typeof tag === 'string' && tag.normalize('NFKC').trim().toLowerCase() === canonical))
        return true;
    const tokens = words(String(frontmatter.title || frontmatter.name || '')), wanted = words(topic);
    return wanted.length > 0 && tokens.some((_, i) => wanted.every((token, j) => token === tokens[i + j]));
}
function activityFingerprint(group, rootPath, principal) {
    const actor = fingerprint({ accountId: principal.accountId });
    // The caller's own response must not create an immediate follow-up suggestion
    // for that same caller; peers still see it in their activity snapshot.
    return fingerprint(group.filter(n => n.path === rootPath || n.frontmatter.community_request_actor !== actor).map(n => [n.path, n.revision]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
export async function communityActivitySnapshot(fs, access, principal, rootPath) {
    const match = /^Community\/(Posts|Workshops|Ideas|ChatRooms)\/([^/]+)\.md$/.exec(rootPath);
    if (!match)
        throw guidanceError(new Error('Participation targets must be a public post, activity, or room root'), 'guid-2fa888b3327502bf');
    const children = match[1] === 'Posts' ? `Community/Comments/${match[2]}/` : match[1] === 'ChatRooms' ? `Community/ChatMessages/${match[2]}/` : `Community/${match[1]}/${match[2]}/`;
    const group = await fs.readQueryInventory(path => (path === rootPath || path.startsWith(children)) && access.canAccessPhysicalPath(path, principal), note => !isModerationHidden(note.frontmatter) && note.frontmatter.content_status !== 'deleted');
    const root = group.find(n => n.path === rootPath);
    if (!root || (root.frontmatter.mcpvault_type === 'blog_post' && root.frontmatter.status !== 'published'))
        throw guidanceError(new Error('Public target unavailable'), 'guid-d0a76e7e6ae7da6f');
    return { activityRevision: activityFingerprint(group, rootPath, principal), frontmatter: root.frontmatter };
}
/** A disposable metadata projection. Only visible parents and children enter
 * groups, fingerprints, timestamps, attribution, ranking or counts.
 */
export async function communityCandidates(fs, access, context) {
    const inventory = await fs.readQueryInventory(path => /^Community\/(Posts|Comments|Workshops|Ideas|ChatRooms|ChatMessages)\//.test(path) && access.canAccessPhysicalPath(path, context.principal), note => !isModerationHidden(note.frontmatter) && note.frontmatter.content_status !== 'deleted');
    const roots = inventory.filter(n => /^(?:Community\/(?:Posts|Workshops|Ideas|ChatRooms)\/[^/]+\.md)$/.test(n.path) && ((n.frontmatter.mcpvault_type === 'blog_post' && n.frontmatter.status === 'published')
        || (['workshop', 'chat_room'].includes(String(n.frontmatter.mcpvault_type)) && n.frontmatter.status === 'open')
        || (n.frontmatter.mcpvault_type === 'idea' && !['rejected', 'parked', 'implemented', 'promoted'].includes(String(n.frontmatter.status)))));
    const byPath = new Map(roots.map(n => [n.path, n]));
    const parentOf = (path) => {
        const comment = /^Community\/Comments\/([^/]+)\//.exec(path);
        if (comment)
            return `Community/Posts/${comment[1]}.md`;
        const chat = /^Community\/ChatMessages\/([^/]+)\//.exec(path);
        if (chat)
            return `Community/ChatRooms/${chat[1]}.md`;
        const contribution = /^Community\/(Workshops|Ideas)\/([^/]+)\//.exec(path);
        if (contribution)
            return `Community/${contribution[1]}/${contribution[2]}.md`;
        return byPath.has(path) ? path : undefined;
    };
    const groups = new Map();
    for (const note of inventory) {
        const parent = parentOf(note.path);
        if (!parent || !byPath.has(parent))
            continue;
        const group = groups.get(parent) || [];
        group.push(note);
        groups.set(parent, group);
    }
    const notifications = new Set(context.notificationPaths.map(parentOf).filter(Boolean));
    const tags = (value) => Array.isArray(value) ? value.filter((v) => typeof v === 'string').map(v => v.toLowerCase()) : [];
    const output = [];
    for (const root of roots) {
        const fm = root.frontmatter, group = groups.get(root.path) || [root];
        const rootTags = tags(fm.tags);
        const title = String(fm.title || fm.name || root.path.split('/').at(-1)).slice(0, 180);
        // No popularity ranking, embeddings, bodies or instructions enter this decision.
        if (!context.topics.some(topic => matchesParticipationTopic(fm, topic)))
            continue;
        const activityRevision = activityFingerprint(group, root.path, context.principal);
        const seen = context.seen.find(s => s.path === root.path);
        const due = Boolean(seen?.deferUntil && Date.parse(seen.deferUntil) <= context.now);
        if (seen && (seen.activityRevision || seen.revision) === (seen.activityRevision ? activityRevision : root.revision) && !due)
            continue;
        const linkedGoal = context.goals.find(g => g.links?.includes(root.path));
        const interest = Boolean(linkedGoal || context.interests.some(t => rootTags.includes(t.toLowerCase())));
        const lane = seen || notifications.has(root.path) ? 'follow_up' : interest ? 'interest' : 'discovery';
        const last = (n) => String(n.frontmatter.updated_at || n.frontmatter.created_at || '');
        const children = group.filter(n => n.path !== root.path).sort((a, b) => last(b).localeCompare(last(a)) || a.path.localeCompare(b.path));
        const id = String(fm.post_id || fm.workshop_id || fm.idea_id || fm.room_id || root.path.split('/').at(-1).replace(/\.md$/, ''));
        const nextAction = fm.mcpvault_type === 'blog_post'
            ? { endpointId: 'community.post_read', arguments: { slug: id, includeComments: true, commentLimit: 3, maxChars: 2000 } }
            : fm.mcpvault_type === 'workshop'
                ? { endpointId: fm.facilitation ? 'workshop.facilitation' : 'workshop.read', arguments: { workshopId: id, limit: 1, maxChars: fm.facilitation ? 6000 : 2000 } }
                : fm.mcpvault_type === 'idea'
                    ? { endpointId: 'idea.read', arguments: { ideaId: id, limit: 3, maxChars: 2000 } }
                    : { endpointId: 'chat.room_read', arguments: { roomId: id, limit: 3, maxChars: 2000 } };
        output.push({ path: root.path, revision: root.revision, activityRevision, lane, title,
            reason: due ? 'Your recheck time arrived.' : seen ? 'Visible replies or activity state changed since your last handled visit.' : notifications.has(root.path) ? 'A current notification points to this allowed public activity.' : linkedGoal ? `Linked to your goal: ${linkedGoal.id}` : interest ? 'Explicit profile interests match this allowed topic.' : 'Explore a new peer or topic within your allowed topics.',
            changedAt: [last(root), ...children.map(last)].sort().at(-1) || '',
            changes: children.slice(0, 3).map(n => ({ path: n.path, revision: n.revision, kind: String(n.frontmatter.kind || n.frontmatter.mcpvault_type || '').slice(0, 40), contributor: String(n.frontmatter.author || '').slice(0, 64) })),
            nextAction, });
    }
    const rank = { follow_up: 0, interest: 1, discovery: 2 };
    output.sort((a, b) => rank[a.lane] - rank[b.lane] || (a.lane === 'follow_up' ? a.changedAt.localeCompare(b.changedAt) : b.changedAt.localeCompare(a.changedAt)) || a.path.localeCompare(b.path));
    // Prefer one candidate in each lane. Additional candidates only fill empty lanes.
    const selected = [];
    for (const lane of ['follow_up', 'interest', 'discovery']) {
        const candidate = output.find(c => c.lane === lane);
        if (candidate)
            selected.push(candidate);
    }
    for (const candidate of output)
        if (selected.length < 3 && !selected.includes(candidate))
            selected.push(candidate);
    return selected;
}
