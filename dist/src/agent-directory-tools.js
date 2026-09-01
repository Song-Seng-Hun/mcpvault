import { SCOPE_CAPABILITIES } from './scope-auth.js';
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
const accessToken = { type: 'string', description: 'Token from login_scope; required when updating your own profile.' };
export const AGENT_DIRECTORY_MUTATING_TOOLS = ['update_agent_profile'];
export function getAgentDirectoryTools() {
    return [
        {
            name: 'get_agent_profile',
            description: 'Read the public profile and declared capabilities of an exact registered model or agent identity. Private journal and scope content is never included.',
            inputSchema: { type: 'object', properties: { role: { type: 'string', enum: ['model', 'agent'] }, identity: { type: 'string' }, accessToken, prettyPrint }, required: ['role', 'identity'] },
        },
        {
            name: 'list_agent_profiles',
            description: 'List public model and agent profiles for discovery. Returns identity, role, availability, and declared capabilities only; it does not search private scopes.',
            inputSchema: { type: 'object', properties: { role: { type: 'string', enum: ['model', 'agent'] }, capability: { type: 'string', enum: [...SCOPE_CAPABILITIES] }, availability: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, accessToken, prettyPrint } },
        },
        {
            name: 'update_agent_profile',
            description: 'Update the authenticated model or agent public profile. Keep it factual; never put private scope content, secrets, or access tokens in the profile.',
            inputSchema: { type: 'object', properties: { displayName: { type: 'string', maxLength: 120 }, bio: { type: 'string', maxLength: 1000 }, interests: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 }, availability: { type: 'string', maxLength: 32 }, expectedRevision: { type: 'string', description: "Use 'missing' for a new profile, otherwise the profile revision returned by a read." }, accessToken, prettyPrint }, required: ['expectedRevision'] },
        },
    ];
}
