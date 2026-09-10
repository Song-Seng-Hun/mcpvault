import { guidanceText } from './guidance-runtime.js';
import type { Tool } from '@modelcontextprotocol/server';
import { EXPLANATION_CRITERIA } from './explanation-model.js';

export const EXPLANATION_ENDPOINTS: Record<string, string> = {
  list_explanations: 'explanations.list', read_explanation: 'explanations.read', claim_explanation: 'explanations.claim',
  release_explanation: 'explanations.release', submit_explanation: 'explanations.draft', review_explanation: 'explanations.review',
};
export const EXPLANATION_MUTATING_TOOLS = ['claim_explanation', 'release_explanation', 'submit_explanation', 'review_explanation'];
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
export function getExplanationTools(): Tool[] {
  return Object.entries(EXPLANATION_ENDPOINTS).map(([name, endpointId]) => {
    const op = endpointId.split('.')[1]!, mutation = EXPLANATION_MUTATING_TOOLS.includes(name);
    const properties: Record<string, any> = {
      sourcePath: text(600), accessToken: text(8192), expectedSourceRevision: digest,
      expectedRevision: { type: 'string', pattern: '^(missing|[a-f0-9]{64})$' }, requestId: text(128),
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, cursor: text(1000),
    };
    if (op === 'draft') properties.draft = { type: 'object', additionalProperties: false, required: ['blocks'], properties: {
      blocks: { type: 'array', minItems: 1, maxItems: 24, items: { type: 'object', additionalProperties: false, required: ['text', 'startLine', 'endLine'], properties: {
        text: text(3000), startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, example: { type: 'boolean' },
      } } },
    } };
    if (op === 'review') properties.review = { type: 'object', additionalProperties: false, required: ['checks'], properties: {
      checks: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['criterion', 'verdict', 'reason', 'blockIndices'], properties: {
        criterion: { type: 'string', enum: [...EXPLANATION_CRITERIA] }, verdict: { type: 'string', enum: ['pass', 'changes', 'uncertain'] }, reason: text(1200),
        blockIndices: { type: 'array', minItems: 1, maxItems: 24, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 23 } },
      } } },
    } };
    return { name, description: guidanceText('guid-bb19c04f48c9e128', `Source-pinned plain-language explanation ${op}. Originals are immutable. Host-selected sources only; Gemini is an advisory drafting preference. Independent verified cross-family review is required before reuse, and source drift invalidates it. No model calls. ${mutation ? 'Use exact source/job revisions and an idempotent requestId; re-read after mutation.' : 'Reads are bounded and check current access and revisions; private drafts require an authorized task account.'}`),
      inputSchema: { type: 'object', additionalProperties: false, properties,
        required: op === 'list' ? [] : ['sourcePath', ...(mutation ? ['expectedSourceRevision', 'expectedRevision', 'requestId'] : []), ...(op === 'draft' ? ['draft'] : op === 'review' ? ['review'] : [])] } };
  });
}
