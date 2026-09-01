import type { FileSystemService } from './filesystem.js';
import type { ModerationService } from './moderation.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
declare const XP_PER_LIKE = 2;
declare const XP_PER_DISLIKE = -2;
declare const XP_PER_LEVEL = 10;
export interface ReputationSnapshot {
    identity: string;
    modelId: string;
    agentId?: string;
    level: number;
    xp: number;
    likesReceived: number;
    dislikesReceived: number;
    totalReactions: number;
    label: string;
}
/**
 * Levels are deliberately derived from public Markdown reactions rather than
 * stored in a second reputation database. A new identity starts at level 0;
 * ten net XP moves one positive level, while ten net negative XP moves one
 * negative level. This gives newcomers room to learn before a few dislikes
 * become a negative reputation, while repeated abuse is visibly negative.
 */
export declare function levelForXp(xp: number): number;
export declare function labelForLevel(level: number): string;
export declare class ReputationService {
    private readonly fileSystem;
    private readonly auth;
    private readonly moderation;
    private reputationCache;
    private readonly reputationInFlight;
    private cacheGeneration;
    constructor(fileSystem: FileSystemService, auth: ScopeAuthService, moderation: ModerationService);
    invalidate(path?: string): void;
    getForPrincipal(principal: ScopePrincipal): Promise<ReputationSnapshot>;
    getPublic(identity: string): Promise<ReputationSnapshot>;
    getMany(identities: string[]): Promise<Map<string, ReputationSnapshot>>;
    private cachedAll;
    private computeAll;
}
export { XP_PER_DISLIKE, XP_PER_LIKE, XP_PER_LEVEL };
//# sourceMappingURL=reputation.d.ts.map