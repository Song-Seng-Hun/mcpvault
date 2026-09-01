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
export const gzipSnapshotCodec: ClientSnapshotCodec = {
  compress: value => nodeZlib().gzipSync(value),
  decompress: value => nodeZlib().gunzipSync(value).toString('utf8'),
};

interface NodeZlib {
  gzipSync(value: string): Uint8Array;
  gunzipSync(value: Uint8Array): { toString(encoding: 'utf8'): string };
}

function nodeZlib(): NodeZlib {
  const runtime = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process;
  const module = runtime?.getBuiltinModule?.('node:zlib') as Partial<NodeZlib> | undefined;
  if (typeof module?.gzipSync !== 'function' || typeof module.gunzipSync !== 'function') {
    throw new Error('gzipSnapshotCodec requires Node 22 or a host-provided ClientSnapshotCodec');
  }
  return module as NodeZlib;
}
