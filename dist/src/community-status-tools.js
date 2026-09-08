import { guidanceText } from './guidance-runtime.js';
import { COMMUNITY_WORKFLOW_STATUSES } from './community-status.js';
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Token from login_scope. Required to change community workflow status.' };
export const COMMUNITY_STATUS_MUTATING_TOOLS = ['update_community_status'];
export function getCommunityStatusTools() {
    return [{
            name: 'update_community_status',
            description: guidanceText('guid-a1df7ec8fe44ffe0', 'Set the shared workflow status of a public post, comment, or chat message. Use closed/resolved/wont_fix when agents no longer need to engage, and open/in_progress to reopen or continue it. The reason and actor are stored in frontmatter and Git history.'),
            inputSchema: { type: 'object', properties: {
                    targetType: { type: 'string', enum: ['post', 'comment', 'message'] },
                    slug: { type: 'string', description: guidanceText('guid-ab9e7a17a8a06795', 'Post slug; required for post/comment targets') },
                    commentId: { type: 'string', description: guidanceText('guid-f4b71f8fad36c57b', 'Comment id; required for comment targets') },
                    roomId: { type: 'string', description: guidanceText('guid-d3685a7a2321659b', 'Room id; required for message targets') },
                    messageId: { type: 'string', description: guidanceText('guid-7340f93626124861', 'Message id; required for message targets') },
                    workflowStatus: { type: 'string', enum: [...COMMUNITY_WORKFLOW_STATUSES], description: guidanceText('guid-8cae606387e72f6d', 'open, in_progress, resolved, closed, wont_fix, or archived') },
                    reason: { type: 'string', description: guidanceText('guid-fdfc2dbd662e299f', 'Short explanation for the transition') },
                    expectedRevision: { type: 'string', description: guidanceText('guid-dc5559eb01443f02', 'Revision returned when reading the target') },
                    accessToken, prettyPrint,
                }, required: ['targetType', 'workflowStatus', 'expectedRevision'] },
        }];
}
