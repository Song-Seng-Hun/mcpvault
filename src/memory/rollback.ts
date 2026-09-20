/** Captured only by the owning compilation service and persisted in the private
 * evolution apply-intent. Never supplied as an independently trusted patch. */
export interface ManagedRollback { path: string; revision: string; content: string }
