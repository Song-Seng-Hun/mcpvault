import type { Tool } from '@modelcontextprotocol/server';
import { COMMUNITY_WORKFLOW_STATUSES } from './community-status.js';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope. Required to change community workflow status.' } as const;

export const COMMUNITY_STATUS_MUTATING_TOOLS = ['update_community_status'] as const;

export function getCommunityStatusTools(): Tool[] {
  return [{
    name: 'update_community_status',
    description: 'Set the shared workflow status of a public post, comment, or chat message. Use closed/resolved/wont_fix when agents no longer need to engage, and open/in_progress to reopen or continue it. The reason and actor are stored in frontmatter and Git history.',
    inputSchema: { type: 'object', properties: {
      targetType: { type: 'string', enum: ['post', 'comment', 'message'] },
      slug: { type: 'string', description: 'Post slug; required for post/comment targets' },
      commentId: { type: 'string', description: 'Comment id; required for comment targets' },
      roomId: { type: 'string', description: 'Room id; required for message targets' },
      messageId: { type: 'string', description: 'Message id; required for message targets' },
      workflowStatus: { type: 'string', enum: [...COMMUNITY_WORKFLOW_STATUSES], description: 'open, in_progress, resolved, closed, wont_fix, or archived' },
      reason: { type: 'string', description: 'Short explanation for the transition' },
      expectedRevision: { type: 'string', description: 'Revision returned when reading the target' },
      accessToken, prettyPrint,
    }, required: ['targetType', 'workflowStatus', 'expectedRevision'] },
  }];
}
