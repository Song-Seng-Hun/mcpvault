import { expect, test } from 'vitest';
import { projectNoteHeadingPresence, projectNoteOutline, selectNoteHeading } from './note-projections.js';

const raw = '# Course\n## First\n### Lesson\nFirst body\n## Second\n### Lesson\nSecond body\n# Other\n## Leaf\n';

test('qualified heading presence follows the actual ancestry rather than global names', () => {
  const wanted = new Set(['course#first#lesson', 'second#lesson', 'course#leaf', 'first#second', 'lesson', 'other#leaf']);
  expect([...projectNoteHeadingPresence(raw, wanted)].sort()).toEqual(['course#first#lesson', 'lesson', 'other#leaf', 'second#lesson']);
});

test('qualified selection disambiguates repeated subsection names and returns physical lines', () => {
  const headings = projectNoteOutline(raw);
  expect(selectNoteHeading(headings, 'Course#Second#Lesson')).toMatchObject({ text: 'Lesson', line: 6 });
  expect(selectNoteHeading(headings, ' First # Lesson ')).toMatchObject({ text: 'Lesson', line: 3 });
  expect(() => selectNoteHeading(headings, 'Lesson')).toThrow(/ambiguous/);
});

test('same-level transitions close a branch, while numeric heading-level gaps are allowed', () => {
  const source = '# Root\n### Child\n# Next\n## Leaf';
  expect([...projectNoteHeadingPresence(source, new Set(['root#child', 'root#leaf', 'next#leaf']))]).toEqual(['root#child', 'next#leaf']);
  expect(() => selectNoteHeading(projectNoteOutline(source), 'Root#Leaf')).toThrow(/not found/);
});

test('Properties and matching fences cannot manufacture an ancestor branch', () => {
  const source = '---\ntitle: Example\n---\n# Real\n~~~md\n## Fake\n~~~\n## Leaf\n';
  expect([...projectNoteHeadingPresence(source, new Set(['real#leaf', 'fake#leaf']))]).toEqual(['real#leaf']);
});

test('literal exact hash titles retain precedence and flat partial selection stays compatible', () => {
  const source = '# A#B\n# A\n## B\n# Detailed explanation\n# Tag#';
  const headings = projectNoteOutline(source);
  expect(selectNoteHeading(headings, 'A#B').line).toBe(1);
  expect(selectNoteHeading(headings, 'explanation').line).toBe(4);
  expect([...projectNoteHeadingPresence(source, new Set(['tag#']))]).toEqual(['tag#']);
});

test('identical qualified branches remain ambiguous for section selection', () => {
  const source = '# Root\n## Leaf\n# Root\n## Leaf';
  expect(() => selectNoteHeading(projectNoteOutline(source), 'Root#Leaf')).toThrow(/ambiguous/);
});
