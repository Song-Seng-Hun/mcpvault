import { expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SemanticSearchService } from './semantic-search.js';
import { SEMANTIC_EMBEDDING_PROFILE, SEMANTIC_MODEL_OPTIONS } from './semantic-profile.js';
import { PathFilter } from './pathfilter.js';
import { tmpdir } from 'node:os';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';

const model = vi.hoisted(() => ({ env: { allowLocalModels: true }, pipeline: vi.fn(async () => Object.assign(async () => ({ tolist: () => [Array(384).fill(1)] }), { dispose: vi.fn() })) }));
vi.mock('@huggingface/transformers', () => model);

test('pinned CPU q8 inference disables unversioned local shadows without a model download', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-model-profile-'));
  const service = new SemanticSearchService(vault, new PathFilter());
  try {
    await (service as any).embed('query', 'query');
    expect(model.pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/multilingual-e5-small', SEMANTIC_MODEL_OPTIONS);
    expect(SEMANTIC_MODEL_OPTIONS).toMatchObject({ revision: expect.stringMatching(/^[a-f0-9]{40}$/), device: 'cpu', dtype: 'q8' });
    expect(model.env.allowLocalModels).toBe(false);
  } finally {
    await service.close();
    const target = await realpath(vault), local = relative(await realpath(tmpdir()), target);
    if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-model-profile-')) throw new Error('Unsafe test cleanup');
    await rm(target, { recursive: true, force: true });
  }
});

test('runtime fingerprint is stable in another Node process without loading inference', async () => {
  const url = new URL('./semantic-profile.ts', import.meta.url).href;
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import { SEMANTIC_EMBEDDING_PROFILE } from ${JSON.stringify(url)}; console.log(SEMANTIC_EMBEDDING_PROFILE);`]);
  expect(stdout.trim()).toBe(SEMANTIC_EMBEDDING_PROFILE);
});
