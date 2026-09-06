import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
export const SEMANTIC_MODEL_ID = 'Xenova/multilingual-e5-small';
export const SEMANTIC_MODEL_OPTIONS = {
    revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    dtype: 'q8', device: 'cpu',
};
// Read small package metadata, never import native inference at server startup.
// Unknown layouts still work, but cannot share persistent vectors across runs.
const require = createRequire(import.meta.url);
function runtimeVersion(name) {
    try {
        let directory = dirname(require.resolve(name));
        for (let depth = 0; depth < 6; depth++) {
            try {
                const value = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
                if (value.name === name && typeof value.version === 'string')
                    return value.version;
            }
            catch { /* Entry points can live below the package root. */ }
            const parent = dirname(directory);
            if (parent === directory)
                break;
            directory = parent;
        }
    }
    catch { /* Optional inference may be unavailable on this host. */ }
    return `unverified:${randomUUID()}`;
}
export const SEMANTIC_EMBEDDING_PROFILE = createHash('sha256').update(JSON.stringify({
    model: SEMANTIC_MODEL_ID, ...SEMANTIC_MODEL_OPTIONS,
    runtimes: ['@huggingface/transformers', '@huggingface/tokenizers', 'onnxruntime-node'].map(runtimeVersion),
    pooling: 'mean', normalize: true, dimensions: 384, inputContract: 'e5-prefix-v1',
})).digest('hex');
