import { normalizeScopeId } from './scopes.js';
export const COMMUNITY_WORKFLOW_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'wont_fix', 'archived'];
const CLOSED_STATUSES = new Set(['resolved', 'closed', 'wont_fix', 'archived']);
const postPath = (slug) => `Community/Posts/${normalizeScopeId(slug, 'slug')}.md`;
const commentPath = (slug, commentId) => `Community/Comments/${normalizeScopeId(slug, 'slug')}/${normalizeScopeId(commentId, 'commentId')}.md`;
const messagePath = (roomId, messageId) => `Community/ChatMessages/${normalizeScopeId(roomId, 'roomId')}/${normalizeScopeId(messageId, 'messageId')}.md`;
function requireParticipant(principal) {
    if (!principal)
        throw new Error('Login is required to change community workflow status');
    return principal;
}
export function workflowStatus(frontmatter) {
    const value = String(frontmatter.workflow_status || 'open').trim().toLowerCase();
    return COMMUNITY_WORKFLOW_STATUSES.includes(value) ? value : 'open';
}
export function isClosedWorkflowStatus(value) {
    return CLOSED_STATUSES.has(String(value || 'open').trim().toLowerCase());
}
export function matchesWorkflowFilter(frontmatter, requested) {
    const filter = String(requested || 'all').trim().toLowerCase();
    if (filter === 'all')
        return true;
    const current = workflowStatus(frontmatter);
    if (filter === 'active')
        return !isClosedWorkflowStatus(current);
    if (!COMMUNITY_WORKFLOW_STATUSES.includes(filter)) {
        throw new Error(`workflowStatus must be active, all, or one of: ${COMMUNITY_WORKFLOW_STATUSES.join(', ')}`);
    }
    return current === filter;
}
export class CommunityStatusService {
    fileSystem;
    constructor(fileSystem) {
        this.fileSystem = fileSystem;
    }
    targetPath(params) {
        switch (params.targetType) {
            case 'post':
                if (!params.slug)
                    throw new Error('slug is required for a post status');
                return postPath(params.slug);
            case 'comment':
                if (!params.slug || !params.commentId)
                    throw new Error('slug and commentId are required for a comment status');
                return commentPath(params.slug, params.commentId);
            case 'message':
                if (!params.roomId || !params.messageId)
                    throw new Error('roomId and messageId are required for a message status');
                return messagePath(params.roomId, params.messageId);
            default:
                throw new Error('targetType must be post, comment, or message');
        }
    }
    async update(params) {
        const principal = requireParticipant(params.principal);
        const status = String(params.workflowStatus || '').trim().toLowerCase();
        if (!COMMUNITY_WORKFLOW_STATUSES.includes(status)) {
            throw new Error(`workflowStatus must be one of: ${COMMUNITY_WORKFLOW_STATUSES.join(', ')}`);
        }
        if (!params.expectedRevision)
            throw new Error('expectedRevision is required; read the item first');
        const path = this.targetPath(params);
        const note = await this.fileSystem.readNote(path);
        const expectedType = params.targetType === 'post' ? 'blog_post' : params.targetType === 'comment' ? 'blog_comment' : 'chat_message';
        if (note.frontmatter.mcpvault_type !== expectedType)
            throw new Error(`Target is not a community ${params.targetType}`);
        const timestamp = new Date().toISOString();
        const reason = String(params.reason || '').trim();
        await this.fileSystem.writeNote({
            path,
            content: note.content,
            frontmatter: {
                ...note.frontmatter,
                workflow_status: status,
                workflow_status_by: principal.agentId || principal.modelId,
                workflow_status_reason: reason,
                workflow_status_updated_at: timestamp,
            },
            expectedRevision: params.expectedRevision,
        });
        const updated = await this.fileSystem.readNote(path);
        return {
            success: true,
            targetType: params.targetType,
            workflowStatus: status,
            closed: isClosedWorkflowStatus(status),
            reason,
            path,
            revision: updated.revision,
        };
    }
}
