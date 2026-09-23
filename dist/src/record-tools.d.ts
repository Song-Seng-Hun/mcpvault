import type { Tool } from '@modelcontextprotocol/server';
/** A small task-facing surface over existing authorized services and endpoints. */
export declare const RECORDING_MCP_TOOLS: Tool[];
export declare const RECORDING_TOOL_NAMES: Set<string>;
export declare function routeRecordingTool(name: string, args: Record<string, unknown>): {
    toolName: string;
    args: Record<string, unknown>;
};
//# sourceMappingURL=record-tools.d.ts.map