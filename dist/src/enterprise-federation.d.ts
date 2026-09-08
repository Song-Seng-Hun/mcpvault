import type { AgentDirectoryService } from './agent-directory.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { SocialService } from './social.js';
export interface PublicFederationHostConfig {
    baseUrl: string;
    trustedHubPublicKey: string;
    actors: Record<string, {
        authToken: string;
    }>;
}
export interface EnterpriseFederationAdapterOptions {
    vaultPath: string;
    social: SocialService;
    directory: AgentDirectoryService;
    config: PublicFederationHostConfig;
}
export declare class EnterpriseFederationAdapter {
    private readonly vaultPath;
    private readonly social;
    private readonly directory;
    private readonly config;
    private readonly statePath;
    private readonly intentsRoot;
    private readonly reader;
    private readonly publishers;
    private state;
    private loaded;
    private mutationTail;
    constructor(options: EnterpriseFederationAdapterOptions);
    private readBounded;
    private writeAtomic;
    private load;
    private save;
    private exclusive;
    private authenticated;
    private publisher;
    private ensureActor;
    private intentPath;
    private prepareIntent;
    private commitAndPublish;
    private targetObjectId;
    private expectedRevision;
    private mutationId;
    private publishProfile;
    private publishPost;
    private deletePost;
    private resolveLocalPostId;
    private publishComment;
    private changeComment;
    private readFederatedPost;
    private listFederatedPosts;
    private listFederatedComments;
    private getFederatedProfile;
    private listFederatedProfiles;
    private localMatches;
    private performIntentLocal;
    private retry;
    dispatch(name: string, argsInput: unknown, principal?: ScopePrincipal): Promise<unknown>;
}
//# sourceMappingURL=enterprise-federation.d.ts.map