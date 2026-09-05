import type { TaskItem } from './types.js';
/** Extract ordinary Obsidian Markdown task items while ignoring YAML
 * frontmatter and matching backtick or tilde fenced examples. */
export declare function iterateMarkdownTasks(content: string, path: string): Generator<TaskItem, void, unknown>;
/** Compatibility array adapter for callers that need random access to tasks. */
export declare function extractMarkdownTasks(content: string, path: string): TaskItem[];
//# sourceMappingURL=markdown-tasks.d.ts.map