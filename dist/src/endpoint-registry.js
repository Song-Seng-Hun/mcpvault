import { boundSearchResults } from './search-limits.js';
const CONTROL_TOOLS = new Set(['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint']);
function catalogLimit(value) {
    const parsed = value === undefined ? 20 : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1)
        throw new Error('limit must be a positive integer');
    return Math.min(parsed, 100);
}
function catalogMaxChars(value) {
    const parsed = value === undefined ? 12000 : Number(value);
    if (!Number.isInteger(parsed) || parsed < 512)
        throw new Error('maxChars must be an integer of at least 512');
    return Math.min(parsed, 20000);
}
function endpointScore(endpoint, terms) {
    if (terms.length === 0)
        return 0;
    const id = endpoint.endpointId.toLowerCase();
    const tool = endpoint.toolName.toLowerCase();
    const corpus = `${id} ${tool} ${endpoint.description.toLowerCase()} ${(endpoint.aliases || []).join(' ').toLowerCase()}`;
    return terms.reduce((score, term) => score + (id === term ? 100 : 0) + (id.includes(term) ? 20 : 0) + (tool.includes(term) ? 10 : 0) + (corpus.includes(term) ? 1 : 0), 0);
}
const EXPLICIT_IDS = {
    register_scope_account: 'auth.register',
    login_scope: 'auth.login',
    logout_scope: 'auth.logout',
    whoami_scope: 'auth.whoami',
    change_scope_password: 'auth.change_password',
    read_note: 'notes.read',
    sync_note_revisions: 'notes.sync_revisions',
    write_note: 'notes.write',
    patch_note: 'notes.patch',
    delete_note: 'notes.delete',
    move_note: 'notes.move',
    preview_move_note: 'notes.move_preview',
    update_task: 'notes.task_update',
    search_notes: 'wiki.search',
    search_scoped_notes: 'wiki.search_scoped',
    comment_on_blog_post: 'community.comment',
    publish_blog_post: 'community.post',
    publish_decision_record: 'wiki.decision_record',
    delete_blog_post: 'community.post_delete',
    list_blog_posts: 'community.posts',
    read_blog_post: 'community.post_read',
    list_blog_comments: 'community.comments',
    send_chat_message: 'chat.message',
    read_chat_room: 'chat.room_read',
    create_chat_room: 'chat.room_create',
    list_chat_rooms: 'chat.rooms',
    list_mentions: 'community.mentions',
    get_reputation: 'community.reputation',
    list_notifications: 'notifications.list',
    mark_notifications_read: 'notifications.mark_read',
    semantic_search_status: 'wiki.semantic_status',
    get_wiki_review_queue: 'wiki.review_queue',
    get_wiki_catalog: 'wiki.catalog',
    get_wiki_neighborhood: 'wiki.neighborhood',
    get_wiki_trail: 'wiki.trail',
    get_wiki_placement_candidates: 'wiki.placement_candidates',
    get_wiki_knowledge_gaps: 'wiki.knowledge_gaps',
    get_wiki_answer_packet: 'wiki.answer_packet',
    get_wiki_authority_map: 'wiki.authority_map',
    get_wiki_vocabulary_health: 'wiki.vocabulary_health',
    resolve_wiki_term: 'wiki.resolve_term',
    preview_wiki_merge: 'wiki.merge_preview',
    get_wiki_maintenance_debt: 'wiki.maintenance_debt',
    capture_wiki_note: 'wiki.capture',
    clarify_wiki_note: 'wiki.clarify',
    distill_wiki_source: 'wiki.distill_source',
    review_wiki_note: 'wiki.review',
    record_wiki_recall: 'wiki.record_recall',
    get_wiki_recall_queue: 'wiki.recall_queue',
    get_wiki_duplicate_candidates: 'wiki.duplicate_candidates',
    get_wiki_review_dashboard: 'wiki.review_dashboard',
    get_wiki_review_packet: 'wiki.review_packet',
    get_wiki_project_packet: 'wiki.project_packet',
    get_wiki_next_actions: 'wiki.next_actions',
    get_wiki_composition_candidates: 'wiki.composition_candidates',
    preview_wiki_split: 'wiki.split_preview',
    get_wiki_inbox: 'wiki.inbox',
    triage_wiki_note: 'wiki.triage',
    read_wiki_projection: 'wiki.read_projection',
    get_wiki_impact_report: 'wiki.impact_report',
    get_wiki_graph_health: 'wiki.graph_health',
    get_wiki_moc_candidates: 'wiki.moc_candidates',
    get_wiki_organization_health: 'wiki.organization_health',
    get_wiki_property_contract: 'wiki.property_contract',
    get_wiki_note_template: 'wiki.note_template',
    get_wiki_bases_view: 'wiki.bases_view',
    get_wiki_home: 'wiki.home',
    preflight_wiki_publish: 'wiki.preflight',
    get_wiki_source_trust: 'wiki.source_trust',
    get_wiki_citation_graph: 'wiki.citation_graph',
    get_wiki_promotion_candidates: 'wiki.promotion_candidates',
    get_wiki_summary_candidates: 'wiki.summary_candidates',
    get_wiki_unused_knowledge: 'wiki.unused_knowledge',
    resurface_wiki_knowledge: 'wiki.resurface',
    update_wiki_projection: 'wiki.projection_update',
    create_idea: 'idea.create',
    list_ideas: 'idea.list',
    read_idea: 'idea.read',
    branch_idea: 'idea.branch',
    update_idea_status: 'idea.status',
    contribute_idea: 'idea.contribute',
    evaluate_idea: 'idea.evaluate',
    create_workshop: 'workshop.create',
    list_workshops: 'workshop.list',
    read_workshop: 'workshop.read',
    contribute_workshop: 'workshop.contribute',
    update_workshop_phase: 'workshop.phase',
    synthesize_workshop: 'workshop.synthesize',
    read_context: 'context.read',
    save_work_state: 'continuity.save',
    resume_work_state: 'continuity.resume',
};
const EXPLICIT_ROUTES = {
    register_scope_account: { method: 'POST', url: '/api/auth/register' },
    login_scope: { method: 'POST', url: '/api/auth/login' },
    logout_scope: { method: 'POST', url: '/api/auth/logout' },
    read_note: { method: 'GET', url: '/api/notes/{path}' },
    sync_note_revisions: { method: 'POST', url: '/api/notes/revisions' },
    write_note: { method: 'POST', url: '/api/notes/{path}' },
    patch_note: { method: 'POST', url: '/api/notes/{path}/patch' },
    preview_move_note: { method: 'GET', url: '/api/notes/move-preview' },
    update_task: { method: 'POST', url: '/api/notes/tasks' },
    search_notes: { method: 'GET', url: '/api/search' },
    search_scoped_notes: { method: 'GET', url: '/api/search/scoped' },
    publish_blog_post: { method: 'POST', url: '/api/community/posts' },
    publish_decision_record: { method: 'POST', url: '/api/wiki/decision-record' },
    delete_blog_post: { method: 'POST', url: '/api/community/posts/{slug}/delete' },
    list_blog_posts: { method: 'GET', url: '/api/community/posts' },
    read_blog_post: { method: 'GET', url: '/api/community/posts/{slug}' },
    comment_on_blog_post: { method: 'POST', url: '/api/community/posts/{slug}/comments' },
    list_blog_comments: { method: 'GET', url: '/api/community/posts/{slug}/comments' },
    send_chat_message: { method: 'POST', url: '/api/chat/rooms/{roomId}/messages' },
    read_chat_room: { method: 'GET', url: '/api/chat/rooms/{roomId}/messages' },
    create_chat_room: { method: 'POST', url: '/api/chat/rooms' },
    list_chat_rooms: { method: 'GET', url: '/api/chat/rooms' },
    list_mentions: { method: 'GET', url: '/api/mentions' },
    get_reputation: { method: 'GET', url: '/api/community/reputation/{identity}' },
    read_context: { method: 'GET', url: '/api/context' },
    resume_work_state: { method: 'GET', url: '/api/continuity' },
    save_work_state: { method: 'POST', url: '/api/continuity' },
    list_notifications: { method: 'GET', url: '/api/notifications' },
    get_wiki_review_queue: { method: 'GET', url: '/api/wiki/review-queue' },
    get_wiki_catalog: { method: 'GET', url: '/api/wiki/catalog' },
    get_wiki_neighborhood: { method: 'GET', url: '/api/wiki/neighborhood' },
    get_wiki_trail: { method: 'GET', url: '/api/wiki/trail' },
    get_wiki_placement_candidates: { method: 'GET', url: '/api/wiki/placement-candidates' },
    get_wiki_knowledge_gaps: { method: 'GET', url: '/api/wiki/knowledge-gaps' },
    get_wiki_answer_packet: { method: 'GET', url: '/api/wiki/answer-packet' },
    get_wiki_authority_map: { method: 'GET', url: '/api/wiki/authority-map' },
    get_wiki_vocabulary_health: { method: 'GET', url: '/api/wiki/vocabulary-health' },
    resolve_wiki_term: { method: 'GET', url: '/api/wiki/resolve-term' },
    preview_wiki_merge: { method: 'GET', url: '/api/wiki/merge-preview' },
    get_wiki_maintenance_debt: { method: 'GET', url: '/api/wiki/maintenance-debt' },
    capture_wiki_note: { method: 'POST', url: '/api/wiki/capture' },
    clarify_wiki_note: { method: 'POST', url: '/api/wiki/clarify' },
    distill_wiki_source: { method: 'POST', url: '/api/wiki/distill-source' },
    review_wiki_note: { method: 'POST', url: '/api/wiki/review' },
    record_wiki_recall: { method: 'POST', url: '/api/wiki/recall' },
    get_wiki_recall_queue: { method: 'GET', url: '/api/wiki/recall-queue' },
    get_wiki_duplicate_candidates: { method: 'GET', url: '/api/wiki/duplicate-candidates' },
    get_wiki_review_dashboard: { method: 'GET', url: '/api/wiki/review-dashboard' },
    get_wiki_review_packet: { method: 'GET', url: '/api/wiki/review-packet' },
    get_wiki_project_packet: { method: 'GET', url: '/api/wiki/project-packet' },
    get_wiki_next_actions: { method: 'GET', url: '/api/wiki/next-actions' },
    get_wiki_composition_candidates: { method: 'GET', url: '/api/wiki/composition-candidates' },
    preview_wiki_split: { method: 'GET', url: '/api/wiki/split-preview' },
    get_wiki_inbox: { method: 'GET', url: '/api/wiki/inbox' },
    triage_wiki_note: { method: 'POST', url: '/api/wiki/triage' },
    read_wiki_projection: { method: 'GET', url: '/api/wiki/projection' },
    get_wiki_impact_report: { method: 'GET', url: '/api/wiki/impact' },
    get_wiki_graph_health: { method: 'GET', url: '/api/wiki/graph-health' },
    get_wiki_moc_candidates: { method: 'GET', url: '/api/wiki/moc-candidates' },
    get_wiki_organization_health: { method: 'GET', url: '/api/wiki/organization-health' },
    get_wiki_property_contract: { method: 'GET', url: '/api/wiki/property-contract' },
    get_wiki_note_template: { method: 'GET', url: '/api/wiki/note-template' },
    get_wiki_bases_view: { method: 'GET', url: '/api/wiki/bases-view' },
    get_wiki_home: { method: 'GET', url: '/api/wiki/home' },
    preflight_wiki_publish: { method: 'GET', url: '/api/wiki/preflight' },
    get_wiki_source_trust: { method: 'GET', url: '/api/wiki/source-trust' },
    get_wiki_citation_graph: { method: 'GET', url: '/api/wiki/citation-graph' },
    get_wiki_promotion_candidates: { method: 'GET', url: '/api/wiki/promotion-candidates' },
    get_wiki_summary_candidates: { method: 'GET', url: '/api/wiki/summary-candidates' },
    get_wiki_unused_knowledge: { method: 'GET', url: '/api/wiki/unused-knowledge' },
    resurface_wiki_knowledge: { method: 'GET', url: '/api/wiki/resurface' },
    update_wiki_projection: { method: 'POST', url: '/api/wiki/projection' },
    create_idea: { method: 'POST', url: '/api/ideas' },
    list_ideas: { method: 'GET', url: '/api/ideas' },
    read_idea: { method: 'GET', url: '/api/ideas/{ideaId}' },
    branch_idea: { method: 'POST', url: '/api/ideas/{parentIdeaId}/branches' },
    update_idea_status: { method: 'POST', url: '/api/ideas/{ideaId}/status' },
    contribute_idea: { method: 'POST', url: '/api/ideas/{ideaId}/contributions' },
    evaluate_idea: { method: 'POST', url: '/api/ideas/{ideaId}/evaluations' },
    create_workshop: { method: 'POST', url: '/api/workshops' },
    list_workshops: { method: 'GET', url: '/api/workshops' },
    read_workshop: { method: 'GET', url: '/api/workshops/{workshopId}' },
    contribute_workshop: { method: 'POST', url: '/api/workshops/{workshopId}/contributions' },
    update_workshop_phase: { method: 'POST', url: '/api/workshops/{workshopId}/phase' },
    synthesize_workshop: { method: 'POST', url: '/api/workshops/{workshopId}/synthesis' },
};
const ENDPOINT_ALIASES = {
    publish_blog_post: ['community', 'post', 'agora', 'debate', 'topic', 'introduction', 'feedback', 'forum', 'blocked', 'help request', 'source code', 'improvement'],
    delete_blog_post: ['community', 'post', 'delete', 'remove', 'archive'],
    list_blog_posts: ['community', 'posts', 'agora', 'debate', 'topic', 'feed'],
    comment_on_blog_post: ['comment', 'reply', 'agora', 'debate', 'stance', 'for', 'against', 'neutral'],
    toggle_reaction: ['like', 'dislike', 'feedback', 'recognition'],
    list_reactions: ['like', 'dislike', 'feedback', 'recognition'],
    list_popular_posts: ['popular', 'liked', 'ranking', 'community'],
    report_content: ['moderation', 'report', 'prompt injection', 'malware', 'spam', 'harassment', 'privacy', 'impersonation'],
    list_moderation_reports: ['moderation', 'report', 'safety', 'abuse'],
    moderate_content: ['moderation', 'warn', 'hide', 'quarantine', 'remove', 'restore', 'ban', 'unban', 'safety'],
    get_reputation: ['reputation', 'level', 'xp', 'experience', 'likes', 'dislikes', 'author level', 'user level'],
    patch_note: ['edit', 'partial', 'harness', 'replace', 'hunk'],
    sync_note_revisions: ['sync', 'delta', 'revision', 'cache', 'changed notes'],
    read_note_lines: ['read', 'partial', 'section', 'range', 'large note'],
    read_context: ['context', 'mention', 'reply', 'nearby', 'thread', 'reference'],
    read_references: ['reference', 'citation', 'evidence', 'wikilink'],
    list_blog_series: ['series', 'chapters', 'episodes'],
    list_author_activity: ['author', 'profile', 'activity', 'posts by user'],
    get_wiki_review_queue: ['wiki', 'knowledge', 'review', 'due', 'stale', 'evidence', 'inbox'],
    get_wiki_catalog: ['wiki', 'catalog', 'index', 'metadata', 'facets', 'moc', 'project', 'tag'],
    get_wiki_neighborhood: ['wiki', 'neighborhood', 'nearby', 'related', 'adjacent', 'moc', 'links', 'semantic'],
    get_wiki_trail: ['wiki', 'trail', 'path', 'connection', 'multi-hop', 'graph', 'links', 'between notes'],
    get_wiki_placement_candidates: ['wiki', 'placement', 'para', 'folder', 'filing', 'organization', 'misplaced', 'lifecycle'],
    get_wiki_knowledge_gaps: ['wiki', 'question', 'hypothesis', 'assumption', 'epistemic', 'active recall', 'research gap', 'disputed', 'negative knowledge'],
    get_wiki_answer_packet: ['wiki', 'answer', 'context', 'packet', 'counterpoint', 'supporting', 'progressive'],
    get_wiki_authority_map: ['wiki', 'authority', 'aliases', 'preferred term', 'vocabulary', 'redirect', 'collision', 'library'],
    get_wiki_vocabulary_health: ['wiki', 'vocabulary', 'tag', 'tag health', 'authority', 'controlled vocabulary', 'facet', 'hygiene'],
    resolve_wiki_term: ['wiki', 'resolve', 'canonical', 'preferred term', 'alias', 'redirect', 'vocabulary'],
    preview_wiki_merge: ['wiki', 'merge', 'consolidate', 'duplicate', 'compare', 'canonical', 'preview'],
    get_wiki_maintenance_debt: ['wiki', 'maintenance', '5s', 'cleanup', 'stale', 'inbox', 'review', 'moc', 'organization debt'],
    capture_wiki_note: ['wiki', 'capture', 'inbox', 'fleeting', 'quick note', 'collect'],
    clarify_wiki_note: ['wiki', 'clarify', 'gtd', 'capture', 'inbox', 'disposition', 'reference', 'project', 'someday', 'delegate'],
    distill_wiki_source: ['wiki', 'source', 'distill', 'literature', 'reading note', 'atomic', 'interpret'],
    review_wiki_note: ['wiki', 'review', 'confirm', 'freshness', 'evidence', 'baseline'],
    record_wiki_recall: ['wiki', 'recall', 'memory', 'remember', 'active recall'],
    get_wiki_recall_queue: ['wiki', 'recall', 'memory', 'remember', 'active recall', 'due review', 'spaced repetition'],
    get_wiki_duplicate_candidates: ['wiki', 'duplicate', 'near duplicate', 'similar note', 'consolidate', 'merge candidates'],
    get_wiki_review_dashboard: ['wiki', 'review', 'dashboard', 'weekly review', 'reflect', 'inbox', 'projects', 'moc'],
    get_wiki_review_packet: ['wiki', 'review', 'packet', 'next action', 'priority', 'evergreen', 'moc question', 'organization'],
    get_wiki_project_packet: ['wiki', 'project', 'gtd', 'planning', 'purpose', 'outcome', 'next action', 'support'],
    get_wiki_next_actions: ['wiki', 'gtd', 'next action', 'action list', 'context', 'task context', 'computer', 'research'],
    get_wiki_composition_candidates: ['wiki', 'atomic', 'atomicity', 'split', 'long note', 'sections', 'composition', 'zettelkasten'],
    preview_wiki_split: ['wiki', 'split', 'merge', 'atomic', 'zettelkasten', 'section', 'extract', 'preview'],
    get_wiki_inbox: ['wiki', 'inbox', 'capture', 'unprocessed', 'triage'],
    triage_wiki_note: ['wiki', 'triage', 'classify', 'organize', 'para', 'lifecycle'],
    read_wiki_projection: ['wiki', 'read', 'summary', 'key points', 'outline', 'section', 'progressive', 'context'],
    get_wiki_impact_report: ['wiki', 'impact', 'stale', 'freshness', 'evidence', 'changed source', 'dependencies'],
    get_wiki_graph_health: ['wiki', 'graph', 'health', 'orphan', 'broken link', 'moc', 'navigation'],
    get_wiki_moc_candidates: ['wiki', 'moc', 'map', 'structure', 'uncovered', 'atomic', 'navigation'],
    get_wiki_organization_health: ['wiki', 'organization', 'properties', 'para', 'zettelkasten', 'gtd', 'moc', 'health', 'metadata', 'typed links'],
    get_wiki_property_contract: ['wiki', 'properties', 'frontmatter', 'schema', 'contract', 'types', 'obsidian'],
    get_wiki_note_template: ['wiki', 'template', 'note template', 'atomic', 'literature', 'question', 'hypothesis', 'decision', 'project', 'moc', 'negative', 'obsidian'],
    preview_move_note: ['move', 'rename', 'backlinks', 'links', 'impact', 'preview'],
    update_task: ['task', 'checkbox', 'gtd', 'complete', 'reopen', 'toggle'],
    get_wiki_bases_view: ['wiki', 'bases', 'obsidian', 'view', 'table', 'properties', 'export'],
    get_wiki_home: ['wiki', 'home', 'launchpad', 'jdex', 'index', 'moc', 'para', 'gtd', 'entrypoint'],
    preflight_wiki_publish: ['wiki', 'duplicate', 'similar', 'conflict', 'preflight', 'related note'],
    publish_decision_record: ['wiki', 'decision', 'decision record', 'adr', 'architecture', 'choice'],
    get_wiki_source_trust: ['wiki', 'source', 'trust', 'provenance', 'reliability'],
    get_wiki_citation_graph: ['wiki', 'citation', 'source', 'provenance', 'evidence', 'graph', 'bibliography'],
    get_wiki_promotion_candidates: ['wiki', 'community', 'promote', 'promotion', 'candidate', 'knowledge'],
    get_wiki_summary_candidates: ['wiki', 'summary', 'summarize', 'projection', 'long note'],
    get_wiki_unused_knowledge: ['wiki', 'unused', 'old', 'stale', 'archive', 'cleanup', 'maintenance'],
    resurface_wiki_knowledge: ['wiki', 'resurface', 'random', 'serendipity', 'zettelkasten', 'rediscover', 'forgotten'],
    update_wiki_projection: ['wiki', 'summary', 'projection', 'progressive', 'highlight', 'distill', 'refresh'],
    create_idea: ['idea', 'brainstorm', 'innovation', 'creative', 'seed', 'proposal'],
    list_ideas: ['idea', 'brainstorm', 'innovation', 'creative', 'seed', 'proposal'],
    read_idea: ['idea', 'brainstorm', 'innovation', 'creative', 'branch', 'challenge'],
    branch_idea: ['idea', 'branch', 'variant', 'alternative', 'mutation', 'divergent'],
    update_idea_status: ['idea', 'status', 'select', 'reject', 'park', 'implement'],
    contribute_idea: ['idea', 'challenge', 'counterexample', 'extension', 'evidence'],
    evaluate_idea: ['idea', 'evaluate', 'novelty', 'feasibility', 'usefulness', 'risk'],
    create_workshop: ['workshop', 'meeting', 'brainstorm', 'ideation', 'agenda', 'creative'],
    list_workshops: ['workshop', 'meeting', 'agenda', 'phase'],
    read_workshop: ['workshop', 'meeting', 'agenda', 'phase', 'contributions'],
    contribute_workshop: ['workshop', 'meeting', 'critique', 'counterexample', 'synthesis'],
    update_workshop_phase: ['workshop', 'meeting', 'phase', 'advance', 'close'],
    synthesize_workshop: ['workshop', 'meeting', 'synthesis', 'decision', 'conclusion'],
};
export function endpointIdForTool(toolName) {
    return EXPLICIT_IDS[toolName] || `mcp.${toolName}`;
}
function routeFor(tool) {
    const explicit = EXPLICIT_ROUTES[tool.name];
    if (explicit)
        return explicit;
    const mutating = tool.name.includes('write') || tool.name.includes('create') || tool.name.includes('update') || tool.name.includes('delete') || tool.name.includes('send') || tool.name.includes('publish') || tool.name.includes('commit') || tool.name.includes('restore') || tool.name.includes('move') || tool.name.includes('manage') || tool.name.includes('toggle') || tool.name.includes('save') || tool.name.includes('watch') || tool.name.includes('accept') || tool.name.includes('resolve') || tool.name.includes('report') || tool.name.includes('initialize') || tool.name.includes('handoff') || tool.name.includes('resume');
    return { method: mutating ? 'POST' : 'GET', url: `/api/mcp/${tool.name}` };
}
function compactEndpoint(endpoint) {
    // At very small budgets the full input schema cannot fit. Keep the stable
    // identifier and route so the caller can retry with a larger budget rather
    // than violating maxChars with one oversized first result.
    return {
        endpointId: endpoint.endpointId,
        method: endpoint.method,
        url: endpoint.url,
        available: endpoint.available,
        state: endpoint.state,
        ...(endpoint.requires.length > 0 && { requires: endpoint.requires }),
        ...(endpoint.reason && { reason: endpoint.reason }),
        schemaOmitted: true,
        hint: 'Retry with a larger maxChars to receive the input schema.',
    };
}
export class EndpointRegistry {
    descriptors = new Map();
    setTools(tools, requiredCapabilities, mutatingTools) {
        this.descriptors.clear();
        for (const tool of tools) {
            if (CONTROL_TOOLS.has(tool.name))
                continue;
            const route = routeFor(tool);
            const required = requiredCapabilities[tool.name];
            this.descriptors.set(endpointIdForTool(tool.name), {
                endpointId: endpointIdForTool(tool.name),
                toolName: tool.name,
                method: route.method,
                url: route.url,
                description: tool.description || `Execute ${tool.name}`,
                input: (tool.inputSchema || {}),
                requires: required ? [required] : [],
                mutating: mutatingTools.has(tool.name),
                ...(ENDPOINT_ALIASES[tool.name] && { aliases: ENDPOINT_ALIASES[tool.name] }),
            });
        }
    }
    resolve(id) {
        return typeof id === 'string' ? this.descriptors.get(id.trim()) : undefined;
    }
    resolveRoute(method, pathname) {
        const normalizedMethod = method.toUpperCase();
        // Static routes must win over a broad trailing `{path}` route such as
        // `/api/notes/{path}`. Without this ordering, `/api/notes/tasks` could
        // accidentally resolve as `notes.read` instead of the task endpoint.
        const orderedEndpoints = [...this.descriptors.values()].sort((left, right) => {
            const leftParameters = (left.url.match(/\{[^}]+\}/g) || []).length;
            const rightParameters = (right.url.match(/\{[^}]+\}/g) || []).length;
            return leftParameters - rightParameters || right.url.length - left.url.length;
        });
        for (const endpoint of orderedEndpoints) {
            if (endpoint.method !== normalizedMethod)
                continue;
            const templateParts = endpoint.url.split('/').filter(Boolean);
            const pathParts = pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
            const lastTemplateIsParameter = /^\{([^}]+)\}$/.test(templateParts.at(-1) || '');
            if (templateParts.length !== pathParts.length && !(lastTemplateIsParameter && pathParts.length >= templateParts.length))
                continue;
            const pathArguments = {};
            let matches = true;
            for (let index = 0; index < templateParts.length; index += 1) {
                const templatePart = templateParts[index];
                const pathPart = index === templateParts.length - 1 && lastTemplateIsParameter
                    ? pathParts.slice(index).join('/')
                    : pathParts[index];
                const parameter = /^\{([^}]+)\}$/.exec(templatePart);
                if (parameter) {
                    pathArguments[parameter[1]] = pathPart;
                }
                else if (templatePart !== pathPart) {
                    matches = false;
                    break;
                }
            }
            if (matches)
                return { endpoint, pathArguments };
        }
        return undefined;
    }
    list(query, requestedLimit, requestedMaxChars, context, activeOnly) {
        const text = typeof query === 'string' ? query.trim().toLowerCase() : '';
        const terms = text.split(/\s+/).filter(Boolean);
        const limit = catalogLimit(requestedLimit);
        const maxChars = catalogMaxChars(requestedMaxChars);
        const endpoints = [...this.descriptors.values()]
            .filter(item => {
            if (terms.length === 0)
                return true;
            const corpus = `${item.endpointId} ${item.toolName} ${item.description} ${(item.aliases || []).join(' ')} ${item.url}`.toLowerCase();
            return terms.every(term => corpus.includes(term) || corpus.replace(/[_./-]+/g, ' ').includes(term));
        })
            .sort((left, right) => endpointScore(right, terms) - endpointScore(left, terms))
            .map(item => {
            const missing = item.requires.filter(required => !context.capabilities.has(required));
            const disabled = context.readOnly && item.mutating;
            const available = !disabled && (item.requires.length === 0 || context.authenticated && missing.length === 0 || item.endpointId === 'auth.register' || item.endpointId === 'auth.login');
            const state = disabled ? 'disabled' : available ? 'ready' : 'locked';
            const reason = disabled ? 'server is read-only' : !context.authenticated && item.requires.length > 0 && item.endpointId !== 'auth.register' && item.endpointId !== 'auth.login' ? 'authentication required' : missing.length > 0 ? `capability required: ${missing.join(', ')}` : undefined;
            return { ...item, available, state, ...(reason && { reason }) };
        })
            .filter(item => !activeOnly || item.available);
        let bounded = boundSearchResults(endpoints, maxChars).slice(0, limit);
        if (bounded.length === 0 && endpoints.length > 0) {
            bounded = boundSearchResults(endpoints.map(compactEndpoint), maxChars).slice(0, limit);
        }
        return { endpoints: bounded, total: endpoints.length, truncated: bounded.length < endpoints.length };
    }
    size() {
        return this.descriptors.size;
    }
}
