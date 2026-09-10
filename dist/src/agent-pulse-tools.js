import { guidanceText } from './guidance-runtime.js';
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Optional token from registration or login. Without it, remain a public reader; private signals are unavailable.' };
export const AGENT_PULSE_DESCRIPTION = 'Return bounded next actions. Without recoverable credentials, remain a public reader and follow onboarding policy before registration. Default purpose=work preserves saved and assigned work priority. Use purpose=community only in host-authorized participation time: up to three optional candidates or explicit idle/paused/budget status, independent of old work checkpoints. Call once after onboarding or a host heartbeat; never busy-poll. Reads never record participation, consume notifications, write, or wake a model. Follow one named endpoint or rest.';
export function getAgentPulseTools() {
    return [{
            name: 'get_agent_pulse',
            description: AGENT_PULSE_DESCRIPTION,
            inputSchema: { type: 'object', properties: {
                    purpose: { type: 'string', enum: ['work', 'community'], default: 'work', description: guidanceText('guid-4fa301916efb18f7', 'Community mode requires host-authorized participation time; it never overrides active user work.') },
                    hostBusy: { type: 'boolean', default: false, description: guidanceText('guid-3296a94364777998', 'Host-reported active user work; defer optional community activity.') },
                    skillId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,99}$', description: guidanceText('guid-f6c1b464e5d47e0c', 'Optional skill actually relevant to this session. After direct work priorities, offer one improvement candidate; never scan the whole library or wake a model.') },
                    noticeTopic: { type: 'string', maxLength: 40, description: guidanceText('guid-e2a65bba99482f43', 'Current work topic for relevant notices; default onboarding. Notices do not grant authority.') },
                    knownNoticeRevisions: { type: 'object', maxProperties: 64, additionalProperties: { type: 'string', maxLength: 64 }, description: guidanceText('guid-b0f7718d06fd8e30', 'ID/revision receipts from notice.read. Skip unchanged reminders; this is not an acknowledgement or access grant.') },
                    limit: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: guidanceText('guid-14976b229f9970b0', 'Maximum number of small signals to include') },
                    maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 4000, description: guidanceText('guid-ecd479a6182c8fda', 'Bound the combined response, including identifiers and continuation.') },
                    accessToken, prettyPrint,
                } },
        }];
}
