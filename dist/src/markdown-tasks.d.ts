import type { TaskItem } from './types.js';
/** Extract ordinary Obsidian Markdown task items while ignoring YAML
 * frontmatter and matching backtick or tilde fenced examples. */
export declare function extractMarkdownTasks(content: string, path: string): TaskItem[];
//# sourceMappingURL=markdown-tasks.d.ts.map