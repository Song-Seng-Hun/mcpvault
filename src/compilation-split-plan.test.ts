import { expect, test } from 'vitest';
import { planVerbatimSplit } from './compilation-split-plan.js';
import { compilationContentHash } from './compilation-model.js';
import { FrontmatterHandler } from './frontmatter.js';

const basis = { documentId: '9cac42de-e32d-41e2-8370-df5f19d3b19c', bundleId: '9cac42de-e32d-41e2-8370-df5f19d3b19d', chapterRoot: 'Parts', ruleVersion: 'v1' };
test('verbatim split preserves exact Korean/CRLF body, original metadata and heading landing points', () => {
  const raw = '---\nllm_wiki_type: knowledge\naliases: [배포]\n---\n# Deploy\r\nOnly after approval. 😀\r\n\r\n## 복구\r\nNever overwrite edits.\r\n';
  const plan = planVerbatimSplit('Manual.md', raw, basis);
  expect(plan.status).toBe('ready'); if (plan.status !== 'ready') return;
  expect(plan.chapters).toHaveLength(2);
  expect(plan.chapters.map(c => new FrontmatterHandler().parse(c.content).content).join('')).toBe(new FrontmatterHandler().parse(raw).content);
  expect(plan.toc).toContain('aliases: [배포]'); expect(plan.toc).toContain('## 복구');
  expect(plan.sourceRevision).toBe(compilationContentHash(raw));
  for (const c of plan.chapters) {
    expect(c.content.split('\n').length).toBeLessThanOrEqual(50);
    expect(c.content).not.toContain('llm_wiki_type: knowledge');
    expect(c.content).toContain('language: source');
    expect(raw.slice(c.startOffset, c.endOffset)).toBe(new FrontmatterHandler().parse(c.content).content);
  }
});
test('split refuses ambiguous anchors, memory owners and links needing relocation instead of losing semantics', () => {
  for (const raw of ['# Same\nA\n# Same\nB\n', '# A\n[[Other]]\n# B\nMore\n',
    '---\nmemory_role: episodic\n---\n# A\nA\n# B\nB\n', '# A\nText ^block\n# B\nB\n']) {
    expect(planVerbatimSplit('Manual.md', raw, basis).status).toBe('review_required');
  }
});
test('split keeps code examples intact and rejects oversized indivisible chapters', () => {
  const raw = '# A\n~~~sh\necho "[[example]]"\n~~~\n# B\nDo not execute examples.\n';
  expect(planVerbatimSplit('Manual.md', raw, basis).status).toBe('ready');
  expect(planVerbatimSplit('Manual.md', '# A\n```\n' + 'data\n'.repeat(60) + '```\n# B\nB', basis).status).toBe('review_required');
});
