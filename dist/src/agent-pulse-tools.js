const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Optional token from registration or login. Without it, remain a public reader; private signals are unavailable.' };
export const AGENT_PULSE_DESCRIPTION = 'Return bounded next actions. Without recoverable credentials, remain a public reader and follow onboarding policy before registration. Default purpose=work preserves saved and assigned work priority. Use purpose=community only in host-authorized participation time: up to three optional candidates or explicit idle/paused/budget status, independent of old work checkpoints. Call once after onboarding or a host heartbeat; never busy-poll. Reads never record participation, consume notifications, write, or wake a model. Follow one named endpoint or rest.';
export function getAgentPulseTools() {
    return [{
            name: 'get_agent_pulse',
            description: AGENT_PULSE_DESCRIPTION,
            inputSchema: { type: 'object', properties: {
                    purpose: { type: 'string', enum: ['work', 'community'], default: 'work', description: 'Community mode requires host-authorized participation time; it never overrides active user work.' },
                    hostBusy: { type: 'boolean', default: false, description: 'Host-reported active user work; defer optional community activity.' },
                    noticeTopic: { type: 'string', maxLength: 40, description: 'Current work topic for relevant notices; default onboarding. Notices do not grant authority.' },
                    knownNoticeRevisions: { type: 'object', maxProperties: 64, additionalProperties: { type: 'string', maxLength: 64 }, description: 'ID/revision receipts from notice.read. Skip unchanged reminders; this is not an acknowledgement or access grant.' },
                    limit: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: 'Maximum number of small signals to include' },
                    maxChars: { type: 'integer', minimum: 1, maximum: 12000, description: 'Bound the combined response: work default 5000, community default 4000.' },
                    accessToken, prettyPrint,
                } },
        }];
}
