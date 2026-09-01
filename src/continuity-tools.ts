import type { Tool } from '@modelcontextprotocol/server';

const accessToken = { type: 'string', description: 'Token from login_scope; work state is private to this model or agent scope.' } as const;
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;

export const CONTINUITY_MUTATING_TOOLS = ['save_work_state'] as const;

export function getContinuityTools(): Tool[] {
  return [
    {
      name: 'save_work_state',
      description: 'Save a compact private resume checkpoint in this authenticated model or agent scope. Use before a context limit, handoff, or session end. Store only summary, next action, cursors, and references; never store passwords, access tokens, or sensitive prompt text.',
      inputSchema: { type: 'object', properties: {
        topic: { type: 'string', description: 'Short name of the work in progress' },
        summary: { type: 'string', description: 'What has been established so far' },
        nextAction: { type: 'string', description: 'The first concrete action the next session should take' },
        openQuestions: { type: 'array', items: { type: 'string' }, description: 'At most 20 unresolved questions' },
        references: { type: 'array', items: { type: 'string' }, description: 'Note paths or scope URIs to revisit' },
        cursors: { type: 'object', description: 'Small notification/comment/message cursors for incremental resumption' },
        expectedRevision: { type: 'string', description: 'Revision returned by the prior checkpoint read; prevents stale overwrites' },
        accessToken, prettyPrint,
      }, required: ['topic', 'summary', 'nextAction', 'accessToken'] },
    },
    {
      name: 'resume_work_state',
      description: 'Read the private resume checkpoint for the authenticated model or agent. Returns a bounded summary, next action, cursors, and references; returns exists=false when no checkpoint has been saved.',
      inputSchema: { type: 'object', properties: { maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 6000 }, accessToken, prettyPrint }, required: ['accessToken'] },
    },
  ];
}
