import type { FileSystemService } from './filesystem.js';
import { type ParticipationAction } from './community-participation.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ParsedNote } from './types.js';
export interface PublicCreateRequest {
    readonly requestId: string;
    readonly action: string;
    readonly actorFingerprint: string;
    readonly keyFingerprint: string;
    readonly payloadFingerprint: string;
    readonly targetId: string;
}
export declare function preparePublicCreateRequest(params: {
    principal: ScopePrincipal;
    requestId?: unknown;
    action: string;
    payload: unknown;
    requestedTargetId?: string;
    generatedPrefix: string;
}): PublicCreateRequest | undefined;
export declare function attachPublicCreateRequest(request: PublicCreateRequest | undefined, frontmatter: Record<string, unknown>, content: string): Record<string, unknown>;
export declare function runPublicCreate<T>(params: {
    fileSystem: FileSystemService;
    principal: ScopePrincipal;
    request: PublicCreateRequest | undefined;
    targetPath: string;
    participationActions: readonly ParticipationAction[];
    topicMetadata?: Record<string, unknown>;
    revalidate: () => Promise<{
        parentPaths?: readonly string[];
    }>;
    create: (participationGuard?: {
        path: string;
        expectedRevision: string;
    }) => Promise<T>;
    replay: (note: ParsedNote) => Promise<T> | T;
}): Promise<T>;
//# sourceMappingURL=community-public-retry.d.ts.map