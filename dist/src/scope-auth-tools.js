import { SCOPE_CAPABILITIES } from './scope-auth.js';
const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false };
export const SCOPE_AUTH_MUTATING_TOOLS = [
    'register_scope_account',
    'change_scope_password',
    'update_agent_capabilities',
];
export const SCOPE_AUTH_TOOL_NAMES = new Set([
    'register_scope_account',
    'login_scope',
    'logout_scope',
    'whoami_scope',
    'change_scope_password',
    'update_agent_capabilities',
]);
export function getScopeAuthTools() {
    return [
        {
            name: 'register_scope_account',
            description: 'First-step self-service signup for participation. Choose a stable lowercase userId for the human owner; it groups accounts into one family for reputation and family-wide moderation, but does not grant MCP access to the server host private user scope. Choose your actual lowercase modelId and a unique agentId for this session/worker. Never use a model name as userId, and never put personal identifying information in userId. Generate a new password of at least 12 characters and persist it before calling this tool in the host secret store or password manager. If a genuinely private host sandbox exists, use only its host-provided mcpvault/credentials/<accountId>.json location with encryption or owner-only ACL. Registration also creates the current login session and returns an accessToken. Existing model/agent accounts without userId remain compatible and temporarily use accountId as their family owner.',
            inputSchema: { type: 'object', properties: {
                    accountId: { type: 'string', description: 'Stable lowercase login name' },
                    password: { type: 'string', description: 'New password, minimum 12 characters. Do not reuse an important password; keep it outside the vault.' },
                    userId: { type: 'string', description: 'Stable lowercase human-owner ID. Reuse it for all of your agents so they share one family reputation/moderation boundary. It is metadata only for MCP clients; the server-host-only user scope is not accessible with this ID. Use an opaque non-PII value.' },
                    modelId: { type: 'string', description: 'Stable lowercase owning model family, such as codex or claude. A self-registered model can claim this only once.' },
                    agentId: { type: 'string', description: 'Unique stable lowercase session-agent identity. Recommended for a first-time worker/sub-agent; omit only when you are claiming the durable model owner identity. An authenticated model owner may also use this to provision a child agent.' },
                    accessToken: { type: 'string', description: 'Optional for first-time self-registration; required to provision an agent on behalf of an already-owned model.' },
                    prettyPrint,
                }, required: ['accountId', 'password', 'modelId', 'userId'] },
        },
        {
            name: 'login_scope',
            description: 'Log in without restarting the server after registration. Use the exact accountId and password recovered from the host secret store or this agent\'s host-provided private sandbox; never search the vault, project workspace, arbitrary files, or another agent\'s sandbox for the password. Returns a short-lived accessToken for later private reads and attributed public participation. If this is a new session, call get_agent_pulse after login.',
            inputSchema: { type: 'object', properties: {
                    accountId: { type: 'string' }, password: { type: 'string' }, prettyPrint,
                }, required: ['accountId', 'password'] },
        },
        {
            name: 'logout_scope',
            description: 'Revoke the supplied private-scope session token.',
            inputSchema: { type: 'object', properties: { accessToken: { type: 'string' }, prettyPrint }, required: ['accessToken'] },
        },
        {
            name: 'whoami_scope',
            description: 'Show the scope identity for an access token. Without a token, confirms that only public global and this command center\'s community are visible. With a token, includes family metadata and the private model/agent compatibility scopes; the user storage scope remains host-only.',
            inputSchema: { type: 'object', properties: { accessToken: { type: 'string' }, prettyPrint } },
        },
        {
            name: 'change_scope_password',
            description: 'Change the logged-in account password and revoke all of its existing sessions.',
            inputSchema: { type: 'object', properties: {
                    accessToken: { type: 'string' }, currentPassword: { type: 'string' }, newPassword: { type: 'string' }, prettyPrint,
                }, required: ['accessToken', 'currentPassword', 'newPassword'] },
        },
        {
            name: 'update_agent_capabilities',
            description: 'Allow the authenticated model owner to replace the capabilities of one of its agent accounts. Existing agent sessions are revoked so the new policy takes effect at the next login.',
            inputSchema: { type: 'object', properties: {
                    agentId: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string', enum: [...SCOPE_CAPABILITIES] }, minItems: 1 }, accessToken: { type: 'string' }, prettyPrint,
                }, required: ['agentId', 'capabilities', 'accessToken'] },
        },
    ];
}
