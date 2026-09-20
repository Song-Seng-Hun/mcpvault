import { expect, test } from 'vitest';
import { referenceFootprint, referenceTargetKeys } from './reference-footprint.js';

const target = { path: 'Notes/대상.md', frontmatter: { aliases: ['Other name', '다른 이름'], stable_id: 'stable-1' } };
const matches = (text: string, frontmatter: Record<string, unknown> = {}) => {
  const footprint = referenceFootprint({ path: 'Else/source.md', text, frontmatter });
  return { ...footprint, matches: footprint.keys.some(k => referenceTargetKeys(target).includes(k)) };
};

test.each([
  ['[[대상#조건|표시]]', {}], ['[view](../Notes/대상.md#조건)', {}],
  ['[[Other name]]', {}], ['[[stable-1]]', {}],
  ['', { review_basis_links: [{ path: 'Notes/대상.md', revision: 'a'.repeat(64) }] }],
  ['', { memory_entries: [{ basis: [{ path: 'Notes/대상.md' }] }] }],
  ['', { arbitrary: { description: 'read [[다른 이름]]' } }],
  ['', { project: 'Notes/대상.md?version=2' }],
  ['', { research_trail: [{ path: 'scope://community/test/Notes/대상.md' }] }],
] as const)('includes navigational AND preserved snapshot references: %s', (text, fm) => {
  expect(matches(text, fm)).toMatchObject({ matches: true, partial: false });
});

test('does not treat examples, arbitrary plain prose or external links as references', () => {
  expect(matches('```md\n[[대상]]\n```\n`[[Other name]]`\n[remote](https://example.com/대상.md)',
    { description: '대상' })).toMatchObject({ matches: false, partial: false });
});

test('never reports complete extraction when occurrence, tree or identity limits truncate', () => {
  expect(matches(Array.from({ length: 202 }, () => '[[else]]').join('\n') + '\n[[대상]]').partial).toBe(true);
  let nested: unknown = '[[대상]]'; for (let i = 0; i < 40; i++) nested = { nested };
  expect(matches('', { nested }).partial).toBe(true);
  expect(() => referenceTargetKeys({ path: 'Notes/대상.md', frontmatter: { aliases: Array.from({ length: 600 }, (_, i) => `name-${i}`) } })).toThrow();
});

test('candidate matching is conservative: same basename never proves actual resolution', () => {
  expect(matches('[[Other/대상.md]]').matches).toBe(true);
  expect(referenceTargetKeys({ path: 'Notes/File.markdown', frontmatter: {} })).toContain('file');
});

test('protocol-looking Wiki aliases are identities, unlike external Markdown URLs', () => {
  const target = referenceTargetKeys({ path: 'Target.md', frontmatter: { aliases: ['urn:local:identity'] } });
  const footprint = referenceFootprint({ path: 'Source.md', text: '[[urn:local:identity]]', frontmatter: {} });
  expect(footprint.keys.some(k => target.includes(k))).toBe(true); expect(footprint.partial).toBe(false);
});
