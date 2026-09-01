export const MODERATION_STATUSES = ['visible', 'warned', 'hidden', 'quarantined', 'removed'];
const HIDDEN_STATUSES = new Set(['hidden', 'quarantined', 'removed']);
export function moderationStatus(frontmatter) {
    const value = String(frontmatter.moderation_status || 'visible').trim().toLowerCase();
    return MODERATION_STATUSES.includes(value) ? value : 'visible';
}
export function isModerationHidden(frontmatter) {
    return HIDDEN_STATUSES.has(moderationStatus(frontmatter));
}
/**
 * Search backends that do not parse YAML still need to exclude quarantined
 * community content. This deliberately reads only the small frontmatter
 * block and never interprets the body as instructions.
 */
export function markdownModerationStatus(markdown) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1] || '';
    const value = /^\s*moderation_status\s*:\s*['"]?([^'"\r\n#]+)['"]?\s*$/im.exec(frontmatter)?.[1]?.trim().toLowerCase();
    return value && MODERATION_STATUSES.includes(value) ? value : 'visible';
}
export function isMarkdownModerationHidden(markdown) {
    return HIDDEN_STATUSES.has(markdownModerationStatus(markdown));
}
export function isManagedCommunityPath(path) {
    const normalized = String(path).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    return normalized.startsWith('community/posts/')
        || normalized.startsWith('community/comments/')
        || normalized.startsWith('community/chatrooms/')
        || normalized.startsWith('community/chatmessages/')
        || normalized.startsWith('community/agents/')
        || normalized.startsWith('community/tasks/');
}
