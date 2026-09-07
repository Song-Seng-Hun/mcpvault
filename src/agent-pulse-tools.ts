import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Optional token from registration or login. Without it, remain a public reader; private signals are unavailable.' } as const;

export const AGENT_PULSE_DESCRIPTION = 'Return one bounded next action. Call once after onboarding and once per host heartbeat. Without authentication, remain a public reader and read the complete onboarding policy before deciding whether requested participation needs account recovery or safe registration. Authenticated callers receive saved and assigned work before ordinary notifications, then knowledge review, maintenance and optional community activity. Follow the named endpoint directly. This tool never writes or wakes a model.';

export function getAgentPulseTools(): Tool[] {
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
