import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export interface TopicPacketOptions {
    mocPath: string;
    query?: string;
    limit?: number;
    maxChars?: number;
    prettyPrint?: boolean;
}
/** Request-local worksheet. Authored assertions are data, not instructions or
 * verified conclusions. No model invocation, persistent summary or write. */
export declare function buildTopicPacket(fs: FileSystemService, access: ScopeAccessPolicy, principal: ScopePrincipal | undefined, options: TopicPacketOptions): Promise<Record<string, any> | {
    mode: string;
    partial: boolean;
    completeTopic: boolean;
    nextAction: {
        endpointId: string;
        arguments: {
            path: string;
            expectedRevision: string | undefined;
            maxChars: number;
        };
    };
    notice: string;
}>;
//# sourceMappingURL=topic-packet.d.ts.map