import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
export interface ContinuityPinSelection {
    pendingEdits?: number[];
    researchTrail?: number[];
}
export interface ContinuityPinResult {
    field: 'pendingEdits' | 'researchTrail';
    index: number;
    state: 'current' | 'stale' | 'unpinned' | 'unavailable';
}
export interface ContinuityValidation {
    checked?: string[];
    unchecked?: string[];
    pins?: ContinuityPinResult[];
    selectedPinsCurrent?: boolean;
    detailsOmitted?: true;
}
/** Explicit indices only. Never execute a stored endpoint or rewrite its guard.
 * Results identify owned checkpoint positions, not hidden targets or fresh prose. */
export declare function inspectContinuityPins(fs: FileSystemService, access: ScopeAccessPolicy, principal: ScopePrincipal, fm: Record<string, any>, selection: ContinuityPinSelection | undefined, watch: (path: string) => void): Promise<{
    pins: ContinuityPinResult[];
    revalidate: () => Promise<void>;
}>;
//# sourceMappingURL=continuity-pins.d.ts.map