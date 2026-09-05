import { expect, test } from 'vitest';
import { projectNoteHeadingPresence, projectNoteOutline } from './note-projections.js';

test('requested heading presence shares exact outline fence and closing-heading semantics', () => {
  const raw = '---\ntitle: Example\n---\n## Real ###\n~~~~md\n## Fenced\n```\n## Still fenced\n~~~~\n## Final\n## Tag#';
  const wanted = new Set(['REAL', 'fenced', 'still fenced', 'final', 'tag#']);
  expect([...projectNoteHeadingPresence(raw, wanted)]).toEqual(['real', 'final', 'tag#']);
  const normalized = new Set([...wanted].map(name => name.toLowerCase()));
  expect([...projectNoteHeadingPresence(raw, wanted)]).toEqual(projectNoteOutline(raw)
    .map(heading => heading.text.toLowerCase()).filter(name => normalized.has(name)));
});
test('many irrelevant headings do not become retained projection entries', () => {
  const raw = Array.from({ length: 30000 }, (_, i) => `## Unrelated ${i}`).join('\n') + '\n## Brainstorm\n## Project support';
  expect([...projectNoteHeadingPresence(raw, new Set(['brainstorm', 'project support']))]).toEqual(['brainstorm', 'project support']);
  expect(projectNoteHeadingPresence(raw, new Set()).size).toBe(0);
});
