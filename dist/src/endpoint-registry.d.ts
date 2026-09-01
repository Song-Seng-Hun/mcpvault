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
}
export interface MatchedEndpoint {
    endpoint: EndpointDescriptor;
    pathArguments: Record<string, string>;
}
export interface EndpointAvailabilityContext {
    readOnly: boolean;
    capabilities: Set<ScopeCapability>;
    authenticated: boolean;
}
export declare function endpointIdForTool(toolName: string): string;
export declare class EndpointRegistry {
    private descriptors;
    setTools(tools: Tool[], requiredCapabilities: Partial<Record<string, ScopeCapability>>, mutatingTools: Set<string>): void;
    resolve(id: unknown): EndpointDescriptor | undefined;
    resolveRoute(method: string, pathname: string): MatchedEndpoint | undefined;
    list(query: unknown, requestedLimit: unknown, requestedMaxChars: unknown, context: EndpointAvailabilityContext, activeOnly: boolean): {
        endpoints: Array<EndpointDescriptor & {
            available: boolean;
            state: 'ready' | 'locked' | 'disabled';
            reason?: string;
        }>;
        total: number;
        truncated: boolean;
    };
    size(): number;
}
//# sourceMappingURL=endpoint-registry.d.ts.map