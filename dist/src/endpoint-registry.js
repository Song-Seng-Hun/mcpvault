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
    const corpus = `${id} ${tool} ${endpoint.description.toLowerCase()}`;
    return terms.reduce((score, term) => score + (id === term ? 100 : 0) + (id.includes(term) ? 20 : 0) + (tool.includes(term) ? 10 : 0) + (corpus.includes(term) ? 1 : 0), 0);
}
const EXPLICIT_IDS = {
    register_scope_account: 'auth.register',
    login_scope: 'auth.login',
    logout_scope: 'auth.logout',
    whoami_scope: 'auth.whoami',
    change_scope_password: 'auth.change_password',
    read_note: 'notes.read',
    write_note: 'notes.write',
    patch_note: 'notes.patch',
    delete_note: 'notes.delete',
    move_note: 'notes.move',
    search_notes: 'wiki.search',
    search_scoped_notes: 'wiki.search_scoped',
    comment_on_blog_post: 'community.comment',
    publish_blog_post: 'community.post',
    list_blog_posts: 'community.posts',
    read_blog_post: 'community.post_read',
    list_blog_comments: 'community.comments',
    send_chat_message: 'chat.message',
    read_chat_room: 'chat.room_read',
    create_chat_room: 'chat.room_create',
    list_chat_rooms: 'chat.rooms',
    list_mentions: 'community.mentions',
    list_notifications: 'notifications.list',
    mark_notifications_read: 'notifications.mark_read',
    semantic_search_status: 'wiki.semantic_status',
    read_context: 'context.read',
    save_work_state: 'continuity.save',
    resume_work_state: 'continuity.resume',
};
const EXPLICIT_ROUTES = {
    register_scope_account: { method: 'POST', url: '/api/auth/register' },
    login_scope: { method: 'POST', url: '/api/auth/login' },
    logout_scope: { method: 'POST', url: '/api/auth/logout' },
    read_note: { method: 'GET', url: '/api/notes/{path}' },
    write_note: { method: 'POST', url: '/api/notes/{path}' },
    patch_note: { method: 'POST', url: '/api/notes/{path}/patch' },
    search_notes: { method: 'GET', url: '/api/search' },
    search_scoped_notes: { method: 'GET', url: '/api/search/scoped' },
    publish_blog_post: { method: 'POST', url: '/api/community/posts' },
    list_blog_posts: { method: 'GET', url: '/api/community/posts' },
    read_blog_post: { method: 'GET', url: '/api/community/posts/{slug}' },
    comment_on_blog_post: { method: 'POST', url: '/api/community/posts/{slug}/comments' },
    list_blog_comments: { method: 'GET', url: '/api/community/posts/{slug}/comments' },
    send_chat_message: { method: 'POST', url: '/api/chat/rooms/{roomId}/messages' },
    read_chat_room: { method: 'GET', url: '/api/chat/rooms/{roomId}/messages' },
    create_chat_room: { method: 'POST', url: '/api/chat/rooms' },
    list_chat_rooms: { method: 'GET', url: '/api/chat/rooms' },
    list_mentions: { method: 'GET', url: '/api/mentions' },
    read_context: { method: 'GET', url: '/api/context' },
    resume_work_state: { method: 'GET', url: '/api/continuity' },
    save_work_state: { method: 'POST', url: '/api/continuity' },
    list_notifications: { method: 'GET', url: '/api/notifications' },
};
export function endpointIdForTool(toolName) {
    return EXPLICIT_IDS[toolName] || `mcp.${toolName}`;
}
function routeFor(tool) {
    const explicit = EXPLICIT_ROUTES[tool.name];
    if (explicit)
        return explicit;
    const mutating = tool.name.includes('write') || tool.name.includes('create') || tool.name.includes('update') || tool.name.includes('delete') || tool.name.includes('send') || tool.name.includes('publish') || tool.name.includes('commit') || tool.name.includes('restore') || tool.name.includes('move') || tool.name.includes('manage') || tool.name.includes('toggle') || tool.name.includes('save') || tool.name.includes('watch') || tool.name.includes('accept') || tool.name.includes('resolve') || tool.name.includes('report') || tool.name.includes('initialize');
    return { method: mutating ? 'POST' : 'GET', url: `/api/mcp/${tool.name}` };
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
            });
        }
    }
    resolve(id) {
        return typeof id === 'string' ? this.descriptors.get(id.trim()) : undefined;
    }
    resolveRoute(method, pathname) {
        const normalizedMethod = method.toUpperCase();
        for (const endpoint of this.descriptors.values()) {
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
            const corpus = `${item.endpointId} ${item.toolName} ${item.description} ${item.url}`.toLowerCase();
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
        const bounded = boundSearchResults(endpoints, maxChars).slice(0, limit);
        return { endpoints: bounded, total: endpoints.length, truncated: bounded.length < endpoints.length };
    }
    size() {
        return this.descriptors.size;
    }
}
