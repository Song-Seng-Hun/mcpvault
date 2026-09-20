import { expect, test } from 'vitest';
import { mergePassages } from './merge-passages.js';

const note = (path: string, content: string, frontmatter: Record<string, unknown> = {}) => ({ path, content,
  revision: (path.startsWith('A') ? 'a' : 'b').repeat(64), frontmatter: { llm_wiki_type: 'knowledge', lifecycle: 'active', project: 'project', ...frontmatter } });
test('passage merge retains every source byte and maps each source revision into the canonical output', () => {
  const a = note('A.md', '# Recovery\nOnly if RAM >= 5 GiB. Never delete originals.\n\n반례 😀 ^exception');
  const b = note('B.md', '# Deployment\nVersion 2.0 requires review.\n');
  const plan = mergePassages(a, b);
  expect(plan.status).toBe('ready'); if (plan.status !== 'ready') throw Error('No plan');
  for (const input of [a, b]) {
    const map = plan.coverage.find(m => m.path === input.path)!;
    expect(map.revision).toBe(input.revision);
    expect(plan.content.slice(map.outputStart, map.outputEnd)).toBe(input.content);
  }
  expect(plan.content.startsWith(b.content)).toBe(true);
});
test('metadata conflicts and ambiguous relocation are review proposals, not silently changed meaning', () => {
  expect(mergePassages(note('A.md', '# A', { version: '1' }), note('B.md', '# B', { version: '2' })).status).toBe('review_required');
  expect(mergePassages(note('A.md', '# A', { source_family: 'a' }), note('B.md', '# B', { source_family: 'b' })).status).toBe('review_required');
  expect(mergePassages(note('A/a.md', '[guide](./guide.md)'), note('B/b.md', '# B')).status).toBe('review_required');
  expect(mergePassages(note('A/a.md', '[[#Condition]]'), note('A/b.md', '# B')).status).toBe('review_required');
});
test('safe same-directory references retain spelling, code examples and anchors without rewriting', () => {
  const source = note('A.md', '# A\r\n[guide](./guide.md)\r\n~~~sh\r\necho "[[#example]]"\r\n~~~\r\nvalue ^block');
  const plan = mergePassages(source, note('B.md', '# B\r\nOther context.'));
  expect(plan.status).toBe('ready'); if (plan.status !== 'ready') throw Error('No plan');
  expect(plan.content).toContain(source.content);
});
test('colliding headings, block anchors and footnotes require explicit compatibility review', () => {
  for (const body of ['# Same\nText', 'text ^block', '[^x]: note']) {
    expect(mergePassages(note('A.md', body), note('B.md', body + '\nMore')).status).toBe('review_required');
  }
});

test('concatenation cannot turn the other document into a fence, comment or HTML block', () => {
  for (const body of ['# B\n```text\nUnclosed', '# B\n~~~\nUnclosed', '# B\n<!-- unclosed', '# B\n<pre>literal']) {
    expect(mergePassages(note('A.md', '# A\nRequired condition.'), note('B.md', body)).status).toBe('review_required');
  }
  const closed = '# B\n```text\n<!-- example only\n```';
  expect(mergePassages(note('A.md', '# A\nRequired condition.'), note('B.md', closed)).status).toBe('ready');
});

test('relative images and assets cannot silently change targets across directories', () => {
  for (const body of ['# A\n![chart](./chart.png)', '# A\n[download](./data.csv)', '# A\n<img src="./chart.png">']) {
    expect(mergePassages(note('A/a.md', body), note('B/b.md', '# B')).status).toBe('review_required');
  }
  expect(mergePassages(note('A.md', '# A\n![chart](./chart.png)'), note('B.md', '# B')).status).toBe('ready');
});

test('relative links cannot create a canonical self-reference or source-lineage cycle', () => {
  for (const target of ['./B.md', '../topic/B.md#section', './A.md', '../topic/A.md']) {
    expect(mergePassages(note('topic/A.md', `# A\n[dependency](${target})`), note('topic/B.md', '# B')).status).toBe('review_required');
  }
});
