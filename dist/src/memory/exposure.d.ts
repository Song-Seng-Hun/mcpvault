import type { ScopePrincipal } from '../scope-auth.js';
export interface MemoryReuse {
    mode?: 'full' | 'if_retained';
    knownReads?: string[];
}
/** Delivery is not retention. Only the in-process host can confirm a context generation. */
export declare class MemoryExposure {
    private receipts;
    private contexts;
    private actor;
    confirm(p: ScopePrincipal, receipt: string, context: string): void;
    invalidate(p: ScopePrincipal): void;
    deliver(packet: any, p: ScopePrincipal | undefined, policy: string, reuse: MemoryReuse, maxChars: number): any;
}
//# sourceMappingURL=exposure.d.ts.map