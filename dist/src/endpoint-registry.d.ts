import type { Tool } from '@modelcontextprotocol/server';
import type { ScopeCapability } from './scope-auth.js';
export interface EndpointDescriptor {
    endpointId: string;
    toolName: string;
    method: 'GET' | 'POST';
    url: string;
    description: string;
    input: Record<string, unknown>;
    requires: string[];
    mutating: boolean;
    aliases?: string[];
    operations?: Record<string, {
        available: boolean;
        state: 'ready' | 'locked' | 'disabled';
        requires: string[];
        reason?: string;
    }>;
}
export interface MatchedEndpoint {
    endpoint: EndpointDescriptor;
    pathArguments: Record<string, string>;
}
export interface EndpointAvailabilityContext {
    readOnly: boolean;
    skillEvolutionEnabled?: boolean;
    capabilities: Set<ScopeCapability>;
    authenticated: boolean;
    principalKey?: string;
    roleplayConfigured?: boolean;
    roleplayWritesConfigured?: boolean;
    economyConfigured?: boolean;
}
export declare function endpointIdForTool(toolName: string): string;
export declare class EndpointRegistry {
    private descriptors;
    setTools(tools: Tool[], requiredCapabilities: Partial<Record<string, ScopeCapability>>, mutatingTools: Set<string>): void;
    resolve(id: unknown): EndpointDescriptor | undefined;
    resolveRoute(method: string, pathname: string): MatchedEndpoint | undefined;
    list(query: unknown, requestedLimit: unknown, requestedMaxChars: unknown, context: EndpointAvailabilityContext, activeOnly: boolean, page?: {
        compact?: boolean;
        cursor?: unknown;
    }): {
        endpoints: Array<EndpointDescriptor & {
            available: boolean;
            state: 'ready' | 'locked' | 'disabled';
            reason?: string;
        }>;
        total: number;
        truncated: boolean;
        nextCursor?: string;
    };
    size(): number;
}
//# sourceMappingURL=endpoint-registry.d.ts.map