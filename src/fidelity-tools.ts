import type { Tool } from '@modelcontextprotocol/server';

export function getFidelityTools(): Tool[] {
  const text = (maxLength: number) => ({ type: 'string', maxLength });
  const locator = { type: 'object', additionalProperties: false, required: ['revision', 'startLine', 'endLine', 'quoteHash'], properties: {
    revision: text(64), startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, quoteHash: text(64),
    heading: text(300), blockId: text(100),
  } };
  return [{ name: 'check_wiki_fidelity', description: 'Read-only, revision-pinned comparison of one intact immutable Markdown source and one output. Compares numbers, dates, versions and quotations at exact body-relative line locators. Agent semantic judgments remain attributed reports, not machine truth. Missing, excluded, translated or ambiguous coverage is partial. No models, writes, confidence scores or publication grants. Read source/output locators before supplying required facts.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sourcePath', 'outputPath', 'sourceRevision', 'outputRevision', 'facts'], properties: {
      sourcePath: text(400), outputPath: text(400), sourceRevision: text(64), outputRevision: text(64),
      facts: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false,
        required: ['id', 'kind', 'sourceLocator', 'comparisonMode', 'semanticJudgment'], properties: {
          id: text(100), kind: { type: 'string', enum: ['condition', 'negation', 'counterexample', 'contradiction', 'number', 'date', 'version', 'quote'] },
          sourceLocator: locator, outputLocator: locator,
          comparisonMode: { type: 'string', enum: ['exact', 'translation', 'calculation', 'ambiguous_unit'] },
          semanticJudgment: { type: 'string', enum: ['preserved', 'missing', 'uncertain'] },
        } } },
      maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000 }, accessToken: text(4096),
    } } }];
}
