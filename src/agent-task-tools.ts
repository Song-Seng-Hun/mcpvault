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
      inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['proposed', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'] }, assignee: { type: 'string' }, requester: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000, default: 6000 }, accessToken, prettyPrint } },
    },
    {
      name: 'update_agent_task',
      description: 'Update a task owned by its requester or assignee. Status changes require a short reason and expectedRevision. Completing a task requires at least one auditable knowledge disposition: link durable knowledgeNotes, link negativeKnowledgeNotes, record a retrospective, or explicitly set noReusableKnowledge with a reason. Useful artifacts may be combined; noReusableKnowledge may not be combined with them.',
      inputSchema: { type: 'object', properties: {
        taskId: { type: 'string' }, status: { type: 'string', enum: ['proposed', 'accepted', 'in_progress', 'blocked', 'completed', 'cancelled'] }, assignee: { type: 'string' }, description: { type: 'string', maxLength: 4000 }, references: { type: 'array', items: { type: 'string' } }, reason: { type: 'string', maxLength: 500 }, retrospective: { type: 'string', maxLength: 1000, description: 'Reusable experiential lesson or reflection; this is not factual evidence by itself' }, knowledgeNotes: { type: 'array', maxItems: 20, items: { type: 'string' }, description: 'Visible public durable knowledge-note paths created or updated as an outcome' }, negativeKnowledgeNotes: { type: 'array', maxItems: 20, items: { type: 'string' }, description: 'Visible public negative-knowledge paths preserving failed or rejected approaches' }, noReusableKnowledge: { type: 'boolean', description: 'Explicitly state that the task produced no reusable knowledge; requires knowledgeDispositionReason and cannot accompany artifacts' }, knowledgeDispositionReason: { type: 'string', maxLength: 1000, description: 'Auditable reason why no reusable knowledge was produced' }, expectedRevision: { type: 'string' }, accessToken, prettyPrint,
      }, required: ['taskId', 'expectedRevision', 'accessToken'] },
    },
  ];
}
