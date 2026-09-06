import { expect, test } from 'vitest';
import { hasUnclosedNoteFence, noteSectionHasContent, projectNoteOutline, projectNoteParagraphs } from './note-projections.js';

test.each(['```md', '~~~~md'])('a fence marker inside a comment cannot swallow real section prose: %s', marker => {
  const raw = `## Protocol\n<!-- Example:\n${marker}\n-->\nRun the input twice.\n\n## Results\nObserved failure.`;
  expect(noteSectionHasContent(raw, ['protocol'])).toBe(true);
  expect(hasUnclosedNoteFence(raw)).toBe(false);
  expect(projectNoteOutline(raw).map(heading => heading.text)).toEqual(['Protocol', 'Results']);
});

test.each(['- [ ]', '- [x]', '* [ ]', '+ [X]', '1. [ ]', '[[]]', '* [[]]', '-   '])('empty placeholder %s does not establish section content', placeholder => {
  expect(noteSectionHasContent(`## Protocol\n${placeholder}`, ['protocol'])).toBe(false);
});

test('inline comments in a real heading do not rename the section for the quality rubric', () => {
  expect(noteSectionHasContent('## Protocol <!-- draft -->\nRepeat the run twice.', ['protocol'])).toBe(true);
});

test('literal comment markers inside a real code fence do not hide its closing delimiter or later prose', () => {
  const raw = '## Protocol\n```html\n<!--\n```\nRun the input twice.';
  expect(noteSectionHasContent(raw, ['protocol'])).toBe(true);
  expect(hasUnclosedNoteFence(raw)).toBe(false);
});

test('inline comment-only content does not count but adjacent explanatory prose does', () => {
  expect(noteSectionHasContent('## Protocol\n<!-- draft --> <!-- TODO -->', ['protocol'])).toBe(false);
  expect(noteSectionHasContent('## Protocol\n<!-- draft --> Run twice. <!-- note -->', ['protocol'])).toBe(true);
});

test('a nested matching heading does not close the enclosing requested section', () => {
  expect(noteSectionHasContent('# Method\n## Protocol\n\n## Setup\nRun twice.', ['method', 'protocol'])).toBe(true);
});

test('Properties and unclosed real fences cannot create section evidence', () => {
  expect(noteSectionHasContent('---\nexample: |\n  ## Protocol\n  Run twice.\n---\nNo section.', ['protocol'])).toBe(false);
  expect(noteSectionHasContent('```md\n## Protocol\nRun twice.', ['protocol'])).toBe(false);
});

test.each(['`<!-- literal marker`', 'Text with ``<!--`` literal marker.', '\\<!-- escaped marker'])('inline literal %s cannot expose subsequent fenced headings', literal => {
  const raw = `# Real\n${literal}\n\n\x60\x60\x60md\n## Hidden example heading\nFAKE\n\x60\x60\x60`;
  expect(projectNoteOutline(raw).map(heading => heading.text)).toEqual(['Real']);
  expect(hasUnclosedNoteFence(raw)).toBe(false);
});

test.each(['`<!-- literal marker`', 'Text with ``<!--`` literal marker.', '\\<!-- escaped marker'])('inline literal %s before a section cannot hide its explanation', literal => {
  expect(noteSectionHasContent(`${literal}\n\n## Protocol\nRun twice.`, ['protocol'])).toBe(true);
});

test('root comment examples do not become visible fallback paragraphs when their fences are ignored', () => {
  const raw = '<!-- Example:\n```md\nFAKE-CONTEXT\n-->\n## Protocol\nREAL-CONTEXT';
  expect([...projectNoteParagraphs(raw)]).toEqual([{ text: 'REAL-CONTEXT', startLine: 6, endLine: 6 }]);
});

test('a root comment separates prose paragraphs without changing their physical locators', () => {
  expect([...projectNoteParagraphs('Before\n<!-- hidden -->\nAfter')]).toEqual([
    { text: 'Before', startLine: 1, endLine: 1 },
    { text: 'After', startLine: 3, endLine: 3 },
  ]);
});

test('a closed multiline inline-code span before a section does not open a comment', () => {
  const raw = '`literal starts\ntext <!-- not a comment\nliteral ends`\n\n## Protocol\nRun twice.';
  expect(noteSectionHasContent(raw, ['protocol'])).toBe(true);
});

test('comment-contained fences cannot poison literal masking for later annotations', () => {
  const raw = '<!-- example:\n```md\n-->\n\n`literal starts\ntext <!-- literal\nends`\n\n## Protocol\n<!-- TODO --> Run twice.';
  expect(noteSectionHasContent(raw, ['protocol'])).toBe(true);
});

test.each(['script', 'pre', 'style', 'div'])('literal fences in a %s block cannot turn a later empty comment into evidence', tag => {
  const raw = `<${tag}>\n\x60\x60\x60\n</${tag}>\n\n## Protocol\n- <!-- TODO -->`;
  expect(noteSectionHasContent(raw, ['protocol'])).toBe(false);
});

test.each(['script', 'pre', 'style', 'div'])('a %s block alone does not provide descriptive protocol context', tag => {
  expect(noteSectionHasContent(`## Protocol\n<${tag}>\n\x60\x60\x60\n</${tag}>`, ['protocol'])).toBe(false);
});

test('descriptive text after a raw HTML block still satisfies its enclosing section', () => {
  expect(noteSectionHasContent('## Protocol\n<script>\n```\n</script>\n\nRun the same input twice.', ['protocol'])).toBe(true);
});
