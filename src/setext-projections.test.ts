import { expect, test } from 'vitest';
import { projectNoteHeadingPresence, projectNoteHeadingSummary, projectNoteOutline, projectNoteParagraphs, selectNoteHeading } from './note-projections.js';

test('Setext levels and physical first lines share mixed ATX ancestry', () => {
  const raw = '---\ntitle: Properties\n---\nCourse\n===\n\nLesson\n---\nBody\n### Detail\nDetail body\n\nNext\n===\n';
  expect(projectNoteOutline(raw)).toEqual([
    { text: 'Course', level: 1, line: 4 }, { text: 'Lesson', level: 2, line: 7 },
    { text: 'Detail', level: 3, line: 10 }, { text: 'Next', level: 1, line: 13 },
  ]);
  expect([...projectNoteHeadingPresence(raw, new Set(['course#lesson#detail', 'next#lesson']))]).toEqual(['course#lesson#detail']);
  expect(selectNoteHeading(projectNoteOutline(raw), 'Course#Lesson').line).toBe(7);
  expect(projectNoteHeadingSummary(raw, 1)).toEqual({ headings: [{ text: 'Course', level: 1, line: 4 }], headingCount: 4, headingChars: 22 });
});

test('a multi-line Setext title belongs to the full paragraph, not just its last line', () => {
  const raw = '  Long title\ncontinued here  \n =  \n\nProse\n';
  expect(projectNoteOutline(raw)).toEqual([{ text: 'Long title\ncontinued here', level: 1, line: 1 }]);
  expect(() => selectNoteHeading(projectNoteOutline(raw), 'continued here')).not.toThrow();
  expect([...projectNoteHeadingPresence(raw, new Set(['continued here']))]).toEqual([]);
});

test('paragraph candidates exclude both lines of Setext headings and keep source line numbers', () => {
  const raw = 'Title\n===\nFirst paragraph\ncontinues\n\nSection\n---\nSecond paragraph\n';
  expect([...projectNoteParagraphs(raw)]).toEqual([
    { text: 'First paragraph\ncontinues', startLine: 3, endLine: 4 },
    { text: 'Second paragraph', startLine: 8, endLine: 8 },
  ]);
});

test.each([
  'Text\n\n---', 'Text\n- - -', 'Text\n    ===', '    Code\n---', '\tCode\n===',
  '# ATX\n---', '> Quote\n---', '> Quote\nlazy continuation\n===',
  '- Item\n---', '- Item\nlazy continuation\n===', '1. Item\ncontinuation\n===',
  '| Column |\n| --- |\nRow\n===', '<div>\nHTML text\n===\n</div>',
  'Before\n```md\nFake\n===\n```\n---', 'Before\n~~~\nFake\n---\n~~~\n===',
])('non-paragraph blocks and separated lines do not manufacture Setext headings: %s', raw => {
  expect(projectNoteOutline(raw).filter(item => item.text !== 'ATX')).toEqual([]);
});

test('Setext detection resumes after excluded blocks without merging text across them', () => {
  const raw = 'Before\n```md\nFake\n===\n```\nAfter\n---\n\n- List\ncontinuation\n\nReal\n=\n';
  expect(projectNoteOutline(raw)).toEqual([{ text: 'After', level: 2, line: 6 }, { text: 'Real', level: 1, line: 12 }]);
});

test('mixed duplicate titles remain ambiguous and qualifiers select only the right branch', () => {
  const raw = '# First\nLesson\n---\n# Second\n## Lesson';
  expect(() => selectNoteHeading(projectNoteOutline(raw), 'Lesson')).toThrow(/ambiguous/);
  expect(selectNoteHeading(projectNoteOutline(raw), 'First#Lesson').line).toBe(2);
});

test('unindenting ends an indented code block before a new root Setext heading', () => {
  expect(projectNoteOutline('    code\nRoot\n===')).toEqual([{ text: 'Root', level: 1, line: 2 }]);
});

test('list continuation paragraphs after blank lines are not promoted to root Setext anchors', () => {
  const raw = '- Item\n\n  Nested\n  ---\n\nRoot\n===\n';
  expect(projectNoteOutline(raw)).toEqual([{ text: 'Root', level: 1, line: 6 }]);
});

test('raw HTML comments spanning blank lines cannot manufacture headings', () => {
  const raw = '<!--\n\nFake\n===\n-->\nReal\n---';
  expect(projectNoteOutline(raw)).toEqual([{ text: 'Real', level: 2, line: 6 }]);
});

test('HTML blocks retain their own termination rule despite Markdown or comment-like content', () => {
  expect(projectNoteOutline('<div>\n---\nFake\n===\n</div>\n')).toEqual([]);
  expect(projectNoteOutline('<div>\n<!--\n\n# Real\n')).toEqual([{ text: 'Real', level: 1, line: 4 }]);
});

test('a complete reference definition does not consume the following root paragraph', () => {
  expect(projectNoteOutline('[ref]: /url\nReal\n===\n')).toEqual([{ text: 'Real', level: 1, line: 2 }]);
});

test('ordered markers other than one cannot interrupt a pending title paragraph', () => {
  expect(projectNoteOutline('Title\n2. continuation\n===\n')).toEqual([{ text: 'Title\n2. continuation', level: 1, line: 1 }]);
  expect(projectNoteOutline('Title\n1. Item\n===\n')).toEqual([]);
});

test('malformed long delimiter rows cannot trigger quadratic whitespace backtracking', () => {
  const started = performance.now();
  const raw = '|---' + ' '.repeat(64000) + 'x';
  expect(projectNoteOutline(raw)).toEqual([]);
  // Regression ceiling, not a throughput benchmark: the old expression took ~2.5s.
  expect(performance.now() - started).toBeLessThan(1000);
});

test('a root ATX heading closes the old list before an indented child heading', () => {
  expect(projectNoteOutline('- item\n# Root\n\n  ## Child\n')).toEqual([
    { text: 'Root', level: 1, line: 2 }, { text: 'Child', level: 2, line: 4 },
  ]);
});

test('nested underlines cannot release list containment and invent another root heading', () => {
  expect(projectNoteOutline('- item\n\n  Nested\n  ---\n  More\n  ===\n')).toEqual([]);
});
