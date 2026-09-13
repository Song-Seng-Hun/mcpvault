export declare const CODEX_HOOK_EVENTS: readonly ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop', 'SessionEnd', 'Interrupt'];
export type CodexHookEventName = typeof CODEX_HOOK_EVENTS[number];
export declare const CODEX_HOOK_ACTIONS: readonly ['resume', 'search', 'candidate', 'checkpoint', 'compilation', 'community'];
export type CodexHookAction = typeof CODEX_HOOK_ACTIONS[number];
export interface CodexHookEvent {
    event: CodexHookEventName;
    sessionId: string;
    reentrant: boolean;
}
export interface CodexHookProject {
    id: string;
    workspace: string;
    definitionHash: string;
    events: CodexHookEventName[];
    actions: CodexHookAction[];
    paths: string[];
}
export interface CodexHookConfig {
    version: 1;
    enabled: boolean;
    accountId: string;
    projects: CodexHookProject[];
}
export declare const hookId: (value: unknown) => value is string;
export declare const hookHash: (value: unknown) => value is string;
/** Routing metadata only. Never open transcript_path or use incoming mode/cwd as authority. */
export declare function decodeCodexHookEvent(value: string): CodexHookEvent;
export declare function validateCodexHookConfig(value: unknown): CodexHookConfig;
//# sourceMappingURL=codex-hook-policy.d.ts.map