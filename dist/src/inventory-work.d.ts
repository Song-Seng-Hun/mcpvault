/** Visit an immutable inventory with synchronous callbacks; no chunk copies. */
export declare function forEachInventoryItem<T>(items: readonly T[], visit: (item: T) => void, assertOpen: () => void): Promise<void>;
//# sourceMappingURL=inventory-work.d.ts.map