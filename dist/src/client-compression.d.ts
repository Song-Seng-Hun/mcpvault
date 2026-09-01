export interface ClientBinaryStore {
    getItem(key: string): Uint8Array | null;
    setItem(key: string, value: Uint8Array): void;
}
export interface AsyncClientBinaryStore {
    getItem(key: string): Promise<Uint8Array | null>;
    setItem(key: string, value: Uint8Array): Promise<void>;
}
export interface ClientSnapshotCodec {
    compress(value: string): Uint8Array;
    decompress(value: Uint8Array): string;
}
/** Node's built-in gzip codec. Browser hosts can provide a codec backed by CompressionStream. */
export declare const gzipSnapshotCodec: ClientSnapshotCodec;
//# sourceMappingURL=client-compression.d.ts.map