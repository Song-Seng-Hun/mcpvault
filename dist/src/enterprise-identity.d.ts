import type { ScopePrincipal } from './scope-auth.js';
export declare function persistentActorId(principal: ScopePrincipal): string;
/** Labels are explanatory text; the full actor ID remains the authority. */
export declare function authorIdentity(principal: ScopePrincipal, duty?: string, peers?: ScopePrincipal[]): {
    actorId: string;
    authorLabel: string;
};
export declare function resolveActorMention(value: string, visible: ScopePrincipal[]): string;
//# sourceMappingURL=enterprise-identity.d.ts.map