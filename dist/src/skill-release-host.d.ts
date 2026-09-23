import type { OwnerActivityRuntimeOptions } from './owner-activity-runtime.js';
import type { McpHttpOptions } from './mcp-http.js';
/** Explicit host opt-in only. Reads existing private material; never creates an
 * account, certificate, listener, approval, grant, MCP registration or directory.
 * Version 1 uses loopback mTLS. Version 2 reuses authenticated account sessions;
 * its fixed read-only target is a consent scope, not runtime/model attestation.
 * Version 3 serves reviewed documents under existing account/source ACLs, with
 * no owner mapping, account grant, runtime attestation or extra listener.
 * Version 4 reads NAS skill files; only the registry hash is pinned locally.
 * Legacy bridges accept only skill read/discover grants, even if another activity
 * already has broader consent elsewhere. A reviewed skill grants no execution. */
export declare function loadReviewedSkillsHost(path: string, expectedVault: string): Promise<{
    ownerPolicyPath: undefined;
    ownerActivity: undefined;
    listener: undefined;
    reviewedSkills: {
        host: import("./skill-release-reader.js").ReviewedSkillHost;
        source: {
            inspect(sourceName: string, options?: {
                signal?: AbortSignal;
                timeoutMs?: number;
            }): Promise<import("./skill-release-source.js").SkillSourceInspection | null>;
            close(): void;
        };
        authorization: {
            assertFresh: () => undefined;
            revalidate(): Promise<void>;
        };
    };
    close(): void;
} | {
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
        authorization: undefined;
    };
    listener: McpHttpOptions | undefined;
    close(): void;
}>;
//# sourceMappingURL=skill-release-host.d.ts.map