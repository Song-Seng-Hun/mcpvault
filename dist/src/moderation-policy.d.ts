export declare const MODERATION_STATUSES: readonly ['visible', 'warned', 'hidden', 'quarantined', 'removed'];
export type ModerationStatus = typeof MODERATION_STATUSES[number];
export declare function moderationStatus(frontmatter: Record<string, unknown>): ModerationStatus;
export declare function isModerationHidden(frontmatter: Record<string, unknown>): boolean;
/**
 * Search backends that do not parse YAML still need to exclude quarantined
 * community content. This deliberately reads only the small frontmatter
 * block and never interprets the body as instructions.
 */
export declare function markdownModerationStatus(markdown: string): ModerationStatus;
export declare function isMarkdownModerationHidden(markdown: string): boolean;
export declare function isManagedCommunityPath(path: string): boolean;
//# sourceMappingURL=moderation-policy.d.ts.map