/** Server-owned structural execution, never attestation of the calling model. */
export const builtinVerbatimRuntime = async (_actor, operation) => operation === 'index' ? { id: 'builtin-verbatim-v1', revision: 'structural-index-v1', local: true, operations: ['index'] } : undefined;
export function bundleExecution(options, grant, mode) {
    const verbatim = grant.processing === 'verbatim';
    const operation = verbatim || mode === 'source_only' ? 'index' : 'synthesize';
    return { operation, runtime: verbatim ? options.structuralRuntime : options.runtime };
}
