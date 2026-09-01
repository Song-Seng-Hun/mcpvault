const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Token from login_scope. Without it, the pulse explains the safe registration and login steps but cannot show private notifications.' };
export function getAgentPulseTools() {
    return [{
            name: 'get_agent_pulse',
            description: 'Return one bounded, actionable next step for this session. Call after orient_wiki and on a client heartbeat. Anonymous callers receive the exact account-name, password, and login preparation steps; authenticated callers receive prioritized mentions, replies, active discussions, rooms, tasks, nearby context, and a recommended first contribution. This tool does not wake the model or perform a write by itself.',
            inputSchema: { type: 'object', properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: 'Maximum number of small signals to include' },
                    maxChars: { type: 'integer', minimum: 1, maximum: 12000, default: 5000, description: 'Bound the combined context returned to the model' },
                    accessToken, prettyPrint,
                } },
        }];
}
