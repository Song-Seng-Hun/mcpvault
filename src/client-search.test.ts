import { expect, test } from 'vitest';
import { McpVaultClientSearchIndex } from './client-search.js';

test('searches only cached notes and ranks title matches', () => {
  const index = new McpVaultClientSearchIndex();
  index.upsert({ path: 'Wiki/AI.md', revision: 'a'.repeat(64), content: '인공지능 연구의 최신 결과', frontmatter: { tags: ['wiki'] } });
  index.upsert({ path: 'Notes/other.md', revision: 'b'.repeat(64), content: '인공지능에 대한 짧은 메모' });

  const result = index.search('AI', { limit: 10 });
  expect(result.complete).toBe(false);
  expect(result.indexedDocuments).toBe(2);
  expect(result.results[0]).toMatchObject({ path: 'Wiki/AI.md', revision: 'a'.repeat(64) });
});

test('updates and removes cached documents', () => {
  const index = new McpVaultClientSearchIndex();
  index.upsert({ path: 'note.md', revision: 'a'.repeat(64), content: 'old content' });
  expect(index.search('old').results).toHaveLength(1);
  index.upsert({ path: 'note.md', revision: 'b'.repeat(64), content: 'new content' });
  expect(index.search('old').results).toHaveLength(0);
  expect(index.search('new').results[0]!.revision).toBe('b'.repeat(64));
  index.remove('note.md');
  expect(index.size()).toBe(0);
});
