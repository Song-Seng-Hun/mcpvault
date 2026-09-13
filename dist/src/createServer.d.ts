import { type HostFeatureConfig } from './host-features.js';
import { Server } from "@modelcontextprotocol/server";
import { FrontmatterHandler } from "./frontmatter.js";
import { PathFilter } from "./pathfilter.js";
import type { MaintenanceHost } from './maintenance-host.js';
import { type CompilationOptions } from './compilation-service.js';
import { type CodexHookConnectionOptions } from './codex-hook-connection.js';
import type { CompilationPublicationOptions } from './compilation-publication-adapter.js';
import { type OwnerActivityRuntimeOptions } from './owner-activity-runtime.js';
import { type DocumentAuthorityOptions } from './document-authority.js';
import { type PublicFederationHostConfig } from './enterprise-federation.js';
import { BenchmarkService, type BenchmarkOptions } from './benchmark-service.js';
import { type SkillEvolutionHost } from './skill-evolution.js';
import type { GuidanceDefinition } from './guidance-catalog.js';
import type { RoleplayStore } from './roleplay-store.js';
import { EndpointRegistry } from "./endpoint-registry.js";
import { type EconomyLedger } from './economy-ledger.js';
import type { EconomyPolicy } from './economy-model.js';
export interface CreateServerOptions extends DocumentAuthorityOptions {
    /** Explicit immutable host selection; never populated by a client request. */
    features?: HostFeatureConfig;
    /** Explicit host-selected sources; no automatic Vault-wide translation. */
    explanations?: {
        sources: import('./explanation-service.js').ExplanationSourceConfig[];
    };
    benchmarks?: Omit<BenchmarkOptions, 'assertActor' | 'accountAvailable' | 'ledger' | 'access' | 'pathFilter'> & {
        /** Bind the existing ledger's trusted proof verifier; not an agent endpoint. */
        bindAuthority?: (service: BenchmarkService) => void;
    };
    /** Trusted host integrations only; never populated from API arguments or Vault notes. */
    workCollaboration?: Pick<import('./work-service.js').WorkServiceOptions, 'executionProfiles' | 'readReviewGitSource' | 'verifyReviewExecution' | 'deterministicCoverage'>;
    /** Trusted human-owner consent and independently verified execution identity. */
    ownerActivity?: OwnerActivityRuntimeOptions;
    /** Explicit host-private allowlist; never enabled by client arguments or features. */
    maintenance?: MaintenanceHost;
    /** Explicit trusted host lifecycle transport. No CLI default, new MCP tool,
     * model runtime, or implicit grant from feature/maintenance selection. */
    codexHooks?: CodexHookConnectionOptions;
    /** Separate host approval and actual execution verifier; never client/feature authority. */
    compilation?: Pick<CompilationOptions, 'host' | 'runtime' | 'adapter'> & {
        /** Trusted host code only; factory selection is not an execution grant.
         * Current host config, runtime, account and source gates still apply. */
        adapterFactory?: (services: CompilationPublicationOptions) => NonNullable<CompilationOptions['adapter']>;
    };
    /** Explicit trusted host registration. Never loaded from a request or Vault note. */
    skillEvolution?: SkillEvolutionHost;
    /** Host-private notice registration/delegation file, reloaded before operations. */
    noticeConfigPath?: string;
    guidanceDefinitions?: readonly GuidanceDefinition[];
    /** Host-provisioned single world; no caller or Vault note can enable this. */
    roleplay?: RoleplayStore;
    /** Host-provisioned ledger only. Never initialized or funded from MCP. */
    economy?: {
        ledger: EconomyLedger;
        policy: EconomyPolicy;
    };
    /** Opt-in host-private enterprise registry. Never inferred from Vault content. */
    enterpriseRegistryPath?: string;
    publicFederation?: PublicFederationHostConfig;
    name?: string;
    version?: string;
    pathFilter?: PathFilter;
    frontmatterHandler?: FrontmatterHandler;
    /** Expose read tools only and reject direct calls to mutating tools. */
    readOnly?: boolean;
    /** Account IDs granted the site-wide moderation capability. */
    moderatorAccounts?: string[];
    /** Stable namespace for this server's private community. */
    commandCenterId?: string;
}
export interface ServerRuntime {
    endpointRegistry: EndpointRegistry;
    dispatchTool: (requestedToolName: string, args?: Record<string, unknown>) => Promise<any>;
    ensureEndpointRegistry: () => void;
    createRequestServer: () => Server;
}
export declare function getServerRuntime(server: Server): ServerRuntime | undefined;
export declare function createServer(vaultPath: string, options?: CreateServerOptions): Server;
//# sourceMappingURL=createServer.d.ts.map