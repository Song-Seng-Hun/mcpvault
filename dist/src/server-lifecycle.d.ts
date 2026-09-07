interface Closeable {
    close(): void | Promise<void>;
}
/** CLI owns transports and the root runtime, regardless of protocol handshakes. */
export declare function createServerLifecycle(root: Closeable): {
    add(handle: Closeable): void;
    close(): Promise<unknown[]>;
};
export {};
//# sourceMappingURL=server-lifecycle.d.ts.map