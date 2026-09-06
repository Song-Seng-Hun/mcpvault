import { expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SemanticSearchService } from './semantic-search.js';
import { SEMANTIC_EMBEDDING_PROFILE, SEMANTIC_MODEL_OPTIONS } from './semantic-profile.js';
import { PathFilter } from './pathfilter.js';
import { availableParallelism, tmpdir } from 'node:os';
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

test('native CPU thread policy is explicit and conservative without unsupported spinning options', () => {
  expect(SEMANTIC_MODEL_OPTIONS).toMatchObject({ session_options: {
    intraOpNumThreads: Math.max(1, Math.min(2, availableParallelism())),
    interOpNumThreads: 1, executionMode: 'sequential',
  } });
  expect((SEMANTIC_MODEL_OPTIONS as any).session_options.extra).toBeUndefined();
});

test('native ONNX accepts the thread policy and runs a tiny in-memory Identity graph', async () => {
  const options = (SEMANTIC_MODEL_OPTIONS as any).session_options;
  expect(options).toBeDefined();
  // Minimal ModelProto: IR8, opset13, one float[3] Identity. Lengths are
  // deliberately below 128, so each protobuf length occupies one byte.
  const field = (tag: number, bytes: number[]) => [tag, bytes.length, ...bytes];
  const string = (value: string) => [...Buffer.from(value)];
  const valueInfo = (name: string) => [
    ...field(10, string(name)),
    ...field(18, field(10, [8, 1, ...field(18, field(10, [8, 3]))])),
  ];
  const node = [...field(10, string('x')), ...field(18, string('y')), ...field(34, string('Identity'))];
  const graph = [...field(10, node), ...field(18, string('identity')), ...field(90, valueInfo('x')), ...field(98, valueInfo('y'))];
  const bytes = new Uint8Array([8, 8, ...field(58, graph), ...field(66, [16, 13])]);
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(bytes, { ...options, executionProviders: ['cpu'] });
  try {
    const result = await session.run({ x: new ort.Tensor('float32', new Float32Array([1, -2, 3]), [3]) });
    expect(Array.from(result.y!.data as Float32Array)).toEqual([1, -2, 3]);
  } finally { await session.release(); }
});
