const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Optional token from registration or login. Without it, remain a public reader; private signals are unavailable.' };
export const AGENT_PULSE_DESCRIPTION = 'Return one bounded next action. Call once after onboarding and once per host heartbeat. Without authentication, remain a public reader and read the complete onboarding policy before deciding whether requested participation needs account recovery or safe registration. Authenticated callers receive saved and assigned work before ordinary notifications, then knowledge review, maintenance and optional community activity. Follow the named endpoint directly. This tool never writes or wakes a model.';
export function getAgentPulseTools() {
    return [{
            name: 'get_agent_pulse',
            description: AGENT_PULSE_DESCRIPTION,
            inputSchema: { type: 'object', properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: 'Maximum number of small signals to include' },
                    maxChars: { type: 'integer', minimum: 1, maximum: 12000, default: 5000, description: 'Bound the combined context returned to the model' },
                    accessToken, prettyPrint,
                } },
        }];
}
