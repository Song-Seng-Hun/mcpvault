import { createHash } from 'node:crypto';
import type { TaskItem } from './types.js';

function taskIdentity(path: string, text: string, occurrence: number, rawText: string): string {
  const blockId = /\s+\^([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/.exec(rawText)?.[1];
  if (blockId) return `task:block:${blockId}`;
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const digest = createHash('sha256').update(`${path}\0${normalized}\0${occurrence}`).digest('hex').slice(0, 16);
  return `task:content:${digest}`;
}

/** Extract ordinary Obsidian Markdown task items while ignoring YAML
 * frontmatter and matching backtick or tilde fenced examples. */
export function extractMarkdownTasks(content: string, path: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  const occurrences = new Map<string, number>();
  let inFrontmatter = false;
  let frontmatterEnded = false;
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;
  const fenceRegex = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.replace(/\r$/, '');
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
    tasks.push({
      path,
      line: index + 1,
      text,
      status: taskMatch[2]!.toLowerCase() === 'x' ? 'completed' : 'open',
      taskId: taskIdentity(path, text, occurrence, text),
    });
  }
  return tasks;
}
