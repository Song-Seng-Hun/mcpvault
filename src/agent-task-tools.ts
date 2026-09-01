import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope; required for task changes.' } as const;

export const AGENT_TASK_MUTATING_TOOLS = ['create_agent_task', 'update_agent_task'] as const;

export function getAgentTaskTools(): Tool[] {
  return [
    {
      name: 'create_agent_task',
      description: 'Create a public structured task in Community/Tasks using Obsidian Markdown. Resolvable [[Note]] links in the description become references automatically; Git remains the change log.',
      inputSchema: { type: 'object', properties: {
        taskId: { type: 'string', description: 'Optional stable id; generated when omitted' }, title: { type: 'string', maxLength: 180 }, description: { type: 'string', maxLength: 4000 },
        assignee: { type: 'string', description: 'Optional exact model or agent identity' }, references: { type: 'array', items: { type: 'string' } }, expectedRevision: { type: 'string', description: 'Use missing for a new task' }, accessToken, prettyPrint,
      }, required: ['title', 'description', 'accessToken'] },
    },
    {
      name: 'read_agent_task',
      description: 'Read one public task with status, ownership, revision, and bounded resolved references.',
      inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, includeContent: { type: 'boolean', default: true }, referenceLimit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }, referenceMaxChars: { type: 'integer', minimum: 1, maximum: 20000, default: 4000 }, accessToken, prettyPrint }, required: ['taskId'] },
    },
    {
      name: 'list_agent_tasks',
      description: 'List public structured tasks with bounded status/requester/assignee filters. Use this for coordination instead of scraping long community threads.',
      inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['proposed', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'] }, assignee: { type: 'string' }, requester: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, accessToken, prettyPrint } },
    },
    {
      name: 'update_agent_task',
      description: 'Update a task owned by its requester or assignee. Status changes require a short reason and expectedRevision, so concurrent agent decisions remain auditable in Git history.',
      inputSchema: { type: 'object', properties: {
        taskId: { type: 'string' }, status: { type: 'string', enum: ['proposed', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'] }, assignee: { type: 'string' }, description: { type: 'string', maxLength: 4000 }, references: { type: 'array', items: { type: 'string' } }, reason: { type: 'string', maxLength: 500 }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['taskId', 'expectedRevision', 'accessToken'] },
    },
  ];
}
