import type { Tool } from '@modelcontextprotocol/server';
/** Shared operation table drives dispatch aliases and advisory discovery. */
export declare const STORY_OPERATIONS: Record<string, {
    tool: string;
    defaultOp: string;
    reads: readonly string[];
    writes: readonly string[];
}>;
export declare const STORY_MUTATING_TOOLS: Set<string>;
export declare function storyReadAlias(tool: string, op: unknown): string | undefined;
export declare function storyEndpointForTool(tool: string): string | undefined;
export declare function assertStoryOperation(endpoint: string, op: unknown): void;
export declare function getStoryTools(): Tool[];
//# sourceMappingURL=story-tools.d.ts.map