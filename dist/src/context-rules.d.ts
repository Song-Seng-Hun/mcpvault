export declare const CONTEXT_INTENTS: readonly ['capture', 'explore', 'decide', 'execute', 'review'];
export type ContextIntent = typeof CONTEXT_INTENTS[number];
export interface ContextRules {
    any?: string[];
    all?: string[];
    exclude?: string[];
    intents?: ContextIntent[];
}
export declare const normalizeContextText: (value: string) => string;
export declare function contextRulesSchema(): Record<string, any>;
export declare function validContextRules(value: unknown): value is ContextRules;
export declare function contextRuleState(value: unknown, input: string, intent: ContextIntent): "conditions_matched" | "conditions_unmatched" | "invalid" | "unspecified";
export declare function assertContextRulesContent(raw: string): void;
//# sourceMappingURL=context-rules.d.ts.map