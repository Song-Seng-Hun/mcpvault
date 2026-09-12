// Explicit diagnostic: fixed public strings, existing local model only; no downloads.
import { SEMANTIC_MODEL_ID, SEMANTIC_MODEL_OPTIONS } from '../dist/src/semantic-profile.js';
import { env, pipeline } from '@huggingface/transformers';
env.allowRemoteModels = false;
env.allowLocalModels = true;
let model;
try {
  model = await pipeline('feature-extraction', SEMANTIC_MODEL_ID, { ...SEMANTIC_MODEL_OPTIONS, local_files_only: true });
  const vectors = (await model(['query: payment retry restrictions', 'passage: 결제 요청은 자동 재전송하지 않는다.', 'passage: 바나나는 노란 과일이다.'], { pooling: 'mean', normalize: true })).tolist();
  if (vectors.length !== 3 || vectors.some(v => v.length !== 384 || v.some(x => !Number.isFinite(x)))) throw Error('invalid_vectors');
  const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  console.log(JSON.stringify({ actualLocalInference: true, model: SEMANTIC_MODEL_ID,
    relevantSimilarity: cosine(vectors[0], vectors[1]), unrelatedSimilarity: cosine(vectors[0], vectors[2]),
    corpusQualityGate: 'not_measured', downloads: false, privateText: false }));
} catch {
  console.log(JSON.stringify({ actualLocalInference: false, reason: 'local_model_or_runtime_unavailable',
    corpusQualityGate: 'not_measured', downloads: false, privateText: false }));
  process.exitCode = 2;
} finally { await model?.dispose(); }
