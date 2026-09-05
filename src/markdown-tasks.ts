import { createHash } from 'node:crypto';
import type { TaskItem } from './types.js';

function taskIdentity(path: string, normalized: string, occurrence: number, rawText: string): string {
  const blockId = /\s+\^([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/.exec(rawText)?.[1];
  if (blockId) return `task:block:${blockId}`;
  const digest = createHash('sha256').update(`${path}\0${normalized}\0${occurrence}`).digest('hex').slice(0, 16);
  return `task:content:${digest}`;
}

/** Extract ordinary Obsidian Markdown task items while ignoring YAML
 * frontmatter and matching backtick or tilde fenced examples. */
export function* iterateMarkdownTasks(content: string, path: string): Generator<TaskItem, void, unknown> {
  const occurrences = new Map<string, number>();
  let inFrontmatter = false;
  let frontmatterEnded = false;
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;
  const fenceRegex = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  // Advance the source cursor before any continue; do not allocate a lines array.
  for (let index = 0, start = 0; start <= content.length; index += 1) {
    const newline = content.indexOf('\n', start);
    const end = newline < 0 ? content.length : newline;
    const line = content.slice(start, end).replace(/\r$/, '');
    start = newline < 0 ? content.length + 1 : newline + 1;
    if (!frontmatterEnded && index === 0 && line === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (line === '---') { inFrontmatter = false; frontmatterEnded = true; }
      continue;
    }
    const fenceMatch = fenceRegex.exec(line);
    if (fenceMatch) {
      const markers = fenceMatch[1]!;
      const trailing = fenceMatch[2]!;
      const char = markers.charAt(0);
      if (!inFence) { inFence = true; fenceChar = char; fenceLength = markers.length; }
      else if (char === fenceChar && markers.length >= fenceLength && trailing.trim() === '') { inFence = false; fenceChar = ''; fenceLength = 0; }
      continue;
    }
    if (inFence) continue;
    const taskMatch = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (!taskMatch) continue;
    const text = taskMatch[3]!.trim();
    const occurrenceKey = text.replace(/\s+/g, ' ').toLowerCase();
    const occurrence = occurrences.get(occurrenceKey) || 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    yield {
      path,
      line: index + 1,
      text,
      status: taskMatch[2]!.toLowerCase() === 'x' ? 'completed' : 'open',
      taskId: taskIdentity(path, occurrenceKey, occurrence, text),
    };
  }
}

/** Compatibility array adapter for callers that need random access to tasks. */
export function extractMarkdownTasks(content: string, path: string): TaskItem[] {
  return [...iterateMarkdownTasks(content, path)];
}
