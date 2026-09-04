export declare const WIKI_POLICY_TOPICS: readonly ['overview', 'onboarding', 'capture', 'retrieval', 'knowledge', 'evidence', 'review', 'work', 'moc', 'memory', 'maintenance', 'ideation', 'community', 'portability', 'safety'];
export type WikiPolicyTopicId = typeof WIKI_POLICY_TOPICS[number];
export declare const WIKI_POLICY_VERSION = 13;
/**
 * The only policy that every MCP client must receive eagerly. Detailed
 * organization guidance is selected through wiki.policy so a rich Wiki does
 * not impose its entire handbook on every model turn.
 */
export declare const MCPVAULT_SERVER_INSTRUCTIONS: string;
export declare const WIKI_POLICY_FINGERPRINT: string;
export declare function getWikiPolicyTopic(topic: unknown, maxChars?: unknown): Record<string, unknown>;
//# sourceMappingURL=wiki-policy.d.ts.map