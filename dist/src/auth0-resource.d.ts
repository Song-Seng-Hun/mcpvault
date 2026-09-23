import { type JWTVerifyGetKey } from 'jose';
import type { ScopePrincipal } from './scope-auth.js';
import type { OwnerActivityExecution, OwnerActivityRuntimeOptions } from './owner-activity-runtime.js';
interface ResearchAuthorization {
    readonly accountId: string;
    readonly subject: string;
}
export type Auth0ResourceChannel = 'primary' | 'local';
export interface Auth0ResourceConfig {
    version: 1;
    issuer: string;
    resource: string;
    scope: string;
    subject: string;
    accountId: string;
    allowedAgentLabels: string[];
    localResource?: {
        resource: string;
        clientId: string;
    };
}
export declare function parseAuth0ResourceConfig(value: unknown): Auth0ResourceConfig;
export declare class Auth0Resource {
    readonly config: Auth0ResourceConfig;
    private readonly keys;
    private readonly authorizations;
    private readonly deniedPolicy;
    private readonly requests;
    constructor(config: Auth0ResourceConfig, keys?: JWTVerifyGetKey);
    /** HTTP-adapter-only boundary, entered AFTER JWT verification and issuance
     * of the matching internal session. Not exposed as an MCP operation. This
     * identifies the authenticated research channel, never a model or device. */
    withResearchSession<T>(authorization: ResearchAuthorization, principal: ScopePrincipal, callback: () => Promise<T>): Promise<T>;
    /** OAuth's approved research scope supplies ordinary collaboration consent.
     * This does not enable features or grant document/account capabilities. */
    ownerActivity(): OwnerActivityRuntimeOptions;
    /** Labels, legacy tokens and localhost alone never enter the verified
     * request context. Independent capability and document checks still apply. */
    ownerExecution(principal?: ScopePrincipal): OwnerActivityExecution | undefined;
    verifyAccessToken(token: string, channel?: Auth0ResourceChannel): Promise<ResearchAuthorization>;
    metadata(channel?: Auth0ResourceChannel): {
        resource: string;
        authorization_servers: string[];
        scopes_supported: string[];
        bearer_methods_supported: string[];
    };
}
/** Host-only configuration loader. The resource must be selected explicitly at
 * startup; a model-supplied path or MCP request can never change it. */
export declare function loadAuth0Resource(vaultPath: string, path: string): Promise<Auth0Resource>;
export {};
//# sourceMappingURL=auth0-resource.d.ts.map