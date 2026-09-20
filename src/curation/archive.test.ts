import { expect, test } from 'vitest';
import { archiveCoverage } from './archive.js';

const note = (content: string, frontmatter: Record<string, unknown> = {}) => ({
  content, frontmatter: { llm_wiki_type: 'knowledge', lifecycle: 'active', ...frontmatter },
});
test('archive requires exact preserved body and semantic metadata, not similar text or age', () => {
  const source = note('# Restore\nOnly if enabled. Never remove backups. 5 GiB. ^restore', { basis: ['[[Evidence]]'] });
  expect(archiveCoverage(source, note(source.content, { basis: ['[[Evidence]]'], updated: '2026-09-20' }))).toBe(true);
  expect(archiveCoverage(source, note(source.content.replace('Never ', ''), source.frontmatter))).toBe(false);
  expect(archiveCoverage(source, note(source.content, { basis: ['[[Other]]'] }))).toBe(false);
  expect(archiveCoverage(source, note(source.content, { ...source.frontmatter, lifecycle: 'archived' }))).toBe(false);
});
test('unknown fields, names, source families and active duties are not discarded as decoration', () => {
  const body = '# 한글\nCondition 😀\n```sh\nkeep --exact\n```';
  for (const metadata of [{ title: 'Only when offline' }, { version: '2' }, { aliases: ['복구'] }, { source_family: 'one' }, { critical_warning: true }]) {
    expect(archiveCoverage(note(body, metadata), note(body))).toBe(false);
  }
  for (const metadata of [{ note_kind: 'task' }, { mandatory: true }, { active_task: 'work' }, { note_kind: 'moc' }]) {
    expect(archiveCoverage(note(body, metadata), note(body, metadata))).toBe(false);
  }
  expect(archiveCoverage(note(''), note(''))).toBe(false);
  expect(archiveCoverage(note(body), note(body.replace('\n', '\r\n')))).toBe(false);
});

test('identical bytes in different folders are not proof of identical reference meaning', () => {
  const a = { ...note('[condition](./rule.md)'), path: 'one/A.md' };
  const b = { ...note(a.content), path: 'two/B.md' };
  expect(archiveCoverage(a, b)).toBe(false);
});
