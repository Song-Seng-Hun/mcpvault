/** Node's built-in gzip codec. Browser hosts can provide a codec backed by CompressionStream. */
export const gzipSnapshotCodec = {
    compress: value => nodeZlib().gzipSync(value),
    decompress: value => nodeZlib().gunzipSync(value).toString('utf8'),
};
function nodeZlib() {
    const runtime = globalThis.process;
    const module = runtime?.getBuiltinModule?.('node:zlib');
    if (typeof module?.gzipSync !== 'function' || typeof module.gunzipSync !== 'function') {
        throw new Error('gzipSnapshotCodec requires Node 22 or a host-provided ClientSnapshotCodec');
    }
    return module;
}
