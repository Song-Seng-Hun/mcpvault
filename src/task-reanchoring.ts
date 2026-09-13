import { iterateMarkdownTasks } from './markdown-tasks.js';

/** A failed edit may offer a fresh read, never permission to replay the old edit. */
export class TaskReanchorError extends Error {
  readonly recovery;
  constructor(path: string, revision: string, content: string, taskId?: string, reason = 'revision_conflict') {
    super(reason === 'revision_conflict' ? 'Revision conflict; re-read the current task before changing it.' : 'Task locator is missing or ambiguous; re-read before changing it.');
    let match: { line: number; taskId: string } | undefined;
    let count = 0;
    // Content IDs include ordinals and cannot prove identity after duplicate
    // insertions/deletions. Only unique explicit block IDs qualify.
    if (taskId?.startsWith('task:block:') && taskId.length <= 160) {
      for (const task of iterateMarkdownTasks(content, path)) {
        if (task.taskId !== taskId) continue;
        count++;
        match = { line: task.line, taskId };
        if (count > 1) { match = undefined; break; }
      }
    }
    this.recovery = {
      error: 'task_reanchor_required', reason, currentRevision: revision,
      ...(match && { candidate: match }),
      nextAction: { endpointId: 'mcp.read_note_lines', arguments: {
        path, expectedRevision: revision, startLine: match?.line ?? 1, endLine: match?.line ?? 40, maxChars: 2000,
      } },
    };
  }
}
