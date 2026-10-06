import { type HostFeatureConfig } from './host-features.js';
import { Server } from "@modelcontextprotocol/server";
import { FrontmatterHandler } from "./frontmatter.js";
import { PathFilter } from "./pathfilter.js";
import { type ScopePrincipal } from "./scope-auth.js";
import type { MaintenanceHost } from './maintenance-host.js';
import { type CompilationOptions } from './compilation-service.js';
import type { CompilationPublicationOptions } from './compilation-publication-adapter.js';
import type { EvolutionOptions } from './evolution/model.js';
import { EvolutionOpportunity, type EvolutionSession } from './evolution/opportunity.js';
import { type EvolutionRuntimeConfig, type EvolutionRuntimeHost } from './evolution/runtime-connection.js';
import { type OwnerActivityRuntimeOptions } from './owner-activity-runtime.js';
import { type DocumentAuthorityOptions } from './document-authority.js';
import { type SkillEvolutionHost } from './skill-evolution.js';
import type { GuidanceDefinition } from './guidance-catalog.js';
import { type ReviewedSkillInspector } from './skill-release-service.js';
import type { ReviewedSkillHost, ReviewedSkillDeliveryFence } from './skill-release-reader.js';
import { EndpointRegistry } from "./endpoint-registry.js";
export interface CreateServerOptions extends DocumentAuthorityOptions {
    /** Existing personal-host account file, outside Vault/source. Never a tool argument. */
    accountStorePath?: string;
    /** Explicit immutable host selection; never populated by a client request. */
    features?: HostFeatureConfig;
    /** Trusted host integrations only; never populated from API arguments or Vault notes. */
    workCollaboration?: Pick<import('./work-service.js').WorkServiceOptions, 'executionProfiles' | 'readReviewGitSource' | 'verifyReviewExecution' | 'deterministicCoverage'>;
    /** Trusted human-owner consent and independently verified execution identity. */
    ownerActivity?: OwnerActivityRuntimeOptions;
    /** Explicit host-private allowlist; never enabled by client arguments or features. */
    maintenance?: MaintenanceHost;
    /** Separate host approval and actual execution verifier; never client/feature authority. */
    compilation?: Pick<CompilationOptions, 'host' | 'runtime' | 'structuralRuntime' | 'adapter'> & {
        /** Trusted host code only; factory selection is not an execution grant.
         * Current host config, runtime, account and source gates still apply. */
        adapterFactory?: (services: CompilationPublicationOptions) => NonNullable<CompilationOptions['adapter']>;
    };
    /** Explicit trusted host registration. Never loaded from a request or Vault note. */
    skillEvolution?: SkillEvolutionHost;
    /** Trusted host evidence/authority only. Feature selection and client labels grant nothing. */
    evolution?: EvolutionOptions;
    /** Concrete existing-account runtime; mutually exclusive with custom legacy callbacks. */
    evolutionRuntime?: EvolutionRuntimeConfig;
    /** Private host admission only. Never request/Vault metadata; quarantine required. */
    reviewedSkills?: {
        host: ReviewedSkillHost;
        source: ReviewedSkillInspector;
        authorization?: ReviewedSkillDeliveryFence | undefined;
    };
    /** Host-private notice registration/delegation file, reloaded before operations. */
    noticeConfigPath?: string;
    guidanceDefinitions?: readonly GuidanceDefinition[];
    name?: string;
    version?: string;
    pathFilter?: PathFilter;
    /** Host-only containment of every unreviewed NAS skill resource. */
    quarantineSkills?: boolean;
    frontmatterHandler?: FrontmatterHandler;
    /** Expose read tools only and reject direct calls to mutating tools. */
    readOnly?: boolean;
    /** Account IDs granted the site-wide moderation capability. */
    moderatorAccounts?: string[];
    /** Stable namespace for this server's private community. */
    commandCenterId?: string;
}
export interface ServerRuntime {
    /** Trusted HTTP adapter only; never an MCP/REST endpoint. */
    issueTrustedResearchSession?: (accountId: string, reportedAgentLabel?: string) => Promise<{
        accessToken: string;
        principal: ScopePrincipal;
        revoke(): void;
    }>;
    /** Host-only acknowledgement of actually retained context; never an MCP argument. */
    confirmMemoryRetention?: (accessToken: string, receipt: string, contextGeneration: string) => Promise<void>;
    invalidateMemoryRetention?: (accessToken: string) => Promise<void>;
    evolutionReview?: import('./evolution/direct-review.js').EvolutionDirectReview;
    /** Trusted in-process host surface. Never registered as an MCP/REST endpoint. */
    evolutionHost?: EvolutionRuntimeHost;
    endpointRegistry: EndpointRegistry;
    dispatchTool: (requestedToolName: string, args?: Record<string, unknown>) => Promise<any>;
    ensureEndpointRegistry: () => void;
    createRequestServer: () => Server;
    /** Existing approved host-session opportunity only; no MCP callable generator or new scheduler. */
    runEvolutionOpportunity?: (request: Parameters<EvolutionOpportunity['run']>[0], principal: ScopePrincipal, session: Pick<EvolutionSession, 'authorize' | 'generate' | 'metering'>) => ReturnType<EvolutionOpportunity['run']>;
}
export declare function getServerRuntime(server: Server): ServerRuntime | undefined;
export declare function createServer(vaultPath: string, options?: CreateServerOptions): Server;
//# sourceMappingURL=createServer.d.ts.map