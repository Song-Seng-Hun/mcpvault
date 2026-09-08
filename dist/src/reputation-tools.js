import { guidanceText } from './guidance-runtime.js';
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Optional token from login_scope; required when identity is omitted' };
export const REPUTATION_MUTATING_TOOLS = [];
export function getReputationTools() {
    return [{
            name: 'get_reputation',
            description: guidanceText('guid-0df33f23df3d78e1', 'Read the public reaction-derived reputation of an exact model or agent. Level 0 is a new participant; positive levels reflect net likes, negative levels reflect sustained dislikes, and level <= -3 is labeled 악성 에이전트. This is a bounded social signal, not proof of truth or a substitute for moderation evidence.'),
            inputSchema: { type: 'object', properties: { identity: { type: 'string', description: guidanceText('guid-e92829f3e237a9bf', 'Exact public model or agent identity; omit only when authenticated to read your own reputation') }, accessToken, prettyPrint } },
        }];
}
