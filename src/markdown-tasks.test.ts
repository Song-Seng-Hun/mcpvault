import { describe, expect, test } from 'vitest';
import { extractMarkdownTasks } from './markdown-tasks.js';

describe('extractMarkdownTasks', () => {
  test('keeps one fence-aware task dialect and stable identities', () => {
    const tasks = extractMarkdownTasks([
      '---',
      'example: "- [ ] not a task"',
      '---',
      '# Plan',
      '- [ ] Open work ^block-id',
      '* [x] Finished work',
      '```md',
      '- [ ] fenced backtick',
      '```',
      '~~~md',
      '- [ ] fenced tilde',
      '~~~',
    ].join('\n'), 'Projects/Plan.md');

    expect(tasks.map(task => ({ line: task.line, status: task.status, taskId: task.taskId }))).toEqual([
      { line: 5, status: 'open', taskId: 'task:block:block-id' },
      { line: 6, status: 'completed', taskId: expect.stringMatching(/^task:content:/) },
    ]);
  });
});
