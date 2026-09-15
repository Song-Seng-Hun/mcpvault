import type { OwnerActivityRuntimeOptions } from './owner-activity-runtime.js';
import type { McpHttpOptions } from './mcp-http.js';
/** Explicit host opt-in only. Reads existing private material; never creates an
 * account, certificate, listener, approval, grant, MCP registration or directory.
 * The CLI starts a separate loopback mTLS listener without changing public HTTP.
 * This bridge accepts only skill read/discover grants, even if another activity
 * already has broader consent elsewhere. A reviewed skill grants no execution. */
export declare function loadReviewedSkillsHost(path: string, expectedVault: string): Promise<{
    ownerPolicyPath: string;
    ownerActivity: OwnerActivityRuntimeOptions & {
        refresh: () => Promise<void>;
    };
    reviewedSkills: {
        host: import("./skill-release-reader.js").ReviewedSkillHost;
        source: {
            inspect(sourceName: string, options?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<import("./skill-release-source.js").SkillSourceInspection | null>;
            close(): void;
        };
    };
    listener: McpHttpOptions;
    close(): void;
}>;
//# sourceMappingURL=skill-release-host.d.ts.map