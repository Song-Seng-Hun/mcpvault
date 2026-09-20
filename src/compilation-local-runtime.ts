import type { CompilationOptions } from './compilation-service.js';
import type { CompilationBundleGrant, CompilationSourcePolicy, CompilationOperation } from './compilation-policy.js';

/** Server-owned structural execution, never attestation of the calling model. */
export const builtinVerbatimRuntime: NonNullable<CompilationOptions['runtime']> = async (_actor, operation) =>
  operation === 'index' ? { id: 'builtin-verbatim-v1', revision: 'structural-index-v1', local: true, operations: ['index'] } : undefined;

export function bundleExecution(options: CompilationOptions, grant: CompilationBundleGrant, mode: CompilationSourcePolicy['mode']) {
  const verbatim = grant.processing === 'verbatim';
  const operation: CompilationOperation = verbatim || mode === 'source_only' ? 'index' : 'synthesize';
  return { operation, runtime: verbatim ? options.structuralRuntime : options.runtime };
}
