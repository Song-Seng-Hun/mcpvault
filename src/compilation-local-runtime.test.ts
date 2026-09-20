import { expect, test } from 'vitest';
import { builtinVerbatimRuntime, bundleExecution } from './compilation-local-runtime.js';
import type { CompilationOptions } from './compilation-service.js';

const actor = { accountId: 'test', modelId: 'test', agentId: 'test', role: 'agent' as const };
const grant = { documentPath: 'Manual.md', documentId: '9cac42de-e32d-41e2-8370-df5f19d3b19c', chapterRoot: 'Chapters' };
test('local processor attests only deterministic indexing, not client synthesis, embeddings or external conversion', async () => {
  expect(await builtinVerbatimRuntime(actor, 'index', ['Manual.md'])).toMatchObject({ id: 'builtin-verbatim-v1', local: true, operations: ['index'] });
  for (const operation of ['synthesize', 'embed', 'vision', 'convert'] as const)
    expect(await builtinVerbatimRuntime(actor, operation, ['Manual.md'])).toBeUndefined();
});
test('structural runtime is never a fallback for legacy or external generation', () => {
  const options = { structuralRuntime: builtinVerbatimRuntime } as CompilationOptions;
  expect(bundleExecution(options, grant, 'synthesis_allowed')).toEqual({ operation: 'synthesize', runtime: undefined });
  expect(bundleExecution(options, grant, 'source_only')).toEqual({ operation: 'index', runtime: undefined });
  expect(bundleExecution(options, { ...grant, processing: 'verbatim' }, 'synthesis_allowed'))
    .toEqual({ operation: 'index', runtime: builtinVerbatimRuntime });
});
