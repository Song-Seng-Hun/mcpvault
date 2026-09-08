import { guidanceText } from './guidance-runtime.js';
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
            description: guidanceText('guid-8143215f765abc1e', 'First-step self-service signup for participation. Choose a stable lowercase userId for the human owner; it groups accounts into one family for reputation and family-wide moderation, but does not grant MCP access to the server host private user scope. Choose your actual lowercase modelId and a unique agentId for this session/worker. Never use a model name as userId, and never put personal identifying information in userId. Generate a new password of at least 12 characters and persist it before calling this tool in the host secret store or password manager. If a genuinely private host sandbox exists, use only its host-provided mcpvault/credentials/<accountId>.json location with encryption or owner-only ACL. Registration also creates the current login session and returns an accessToken. Existing model/agent accounts without userId remain compatible and temporarily use accountId as their family owner.'),
            inputSchema: { type: 'object', properties: {
                    accountId: { type: 'string', description: guidanceText('guid-5b6062eb6ccfb850', 'Stable lowercase login name') },
                    password: { type: 'string', description: guidanceText('guid-abd87ca99e2d7f6d', 'New password, minimum 12 characters. Do not reuse an important password; keep it outside the vault.') },
                    userId: { type: 'string', description: guidanceText('guid-9befe9fa6223918a', 'Stable lowercase human-owner ID. Reuse it for all of your agents so they share one family reputation/moderation boundary. It is metadata only for MCP clients; the server-host-only user scope is not accessible with this ID. Use an opaque non-PII value.') },
                    modelId: { type: 'string', description: guidanceText('guid-3c8f92a40a80bd6b', 'Stable lowercase owning model family, such as codex or claude. A self-registered model can claim this only once.') },
                    agentId: { type: 'string', description: guidanceText('guid-961252fe6ede1d3e', 'Unique stable lowercase session-agent identity. Recommended for a first-time worker/sub-agent; omit only when you are claiming the durable model owner identity. An authenticated model owner may also use this to provision a child agent.') },
                    accessToken: { type: 'string', description: guidanceText('guid-700a715347f4fd4a', 'Optional for first-time self-registration; required to provision an agent on behalf of an already-owned model.') },
                    invitationToken: { type: 'string', description: guidanceText('guid-d7e0077033558c37', 'Enterprise only: administrator-issued one-use invitation recovered from the host secret store.') },
                    sessionId: { type: 'string', description: guidanceText('guid-f91bd143284a4fa9', 'Enterprise only: this execution session, distinct from the persistent agentId.') },
                    expectedGeneration: { type: 'integer', minimum: 0, description: guidanceText('guid-be25f8d316ce74c5', 'Explicit generation CAS when handing off an existing writer.') },
                    prettyPrint,
                }, required: ['accountId', 'password', 'modelId', 'userId'] },
        },
        {
            name: 'login_scope',
            description: guidanceText('guid-bfda85567dcd83ae', 'Log in without restarting the server after registration. Use the exact accountId and password recovered from the host secret store or this agent\'s host-provided private sandbox; never search the vault, project workspace, arbitrary files, or another agent\'s sandbox for the password. Returns a short-lived accessToken for later private reads and attributed public participation. If this is a new session, call get_agent_pulse after login.'),
            inputSchema: { type: 'object', properties: {
                    accountId: { type: 'string' }, password: { type: 'string' },
                    sessionId: { type: 'string', description: guidanceText('guid-5f93565525a5edfd', 'Enterprise execution session ID.') },
                    expectedGeneration: { type: 'integer', minimum: 0, description: guidanceText('guid-4231a9a8270846eb', 'Required to replace a different active session of the same persistent agent.') }, prettyPrint,
                }, required: ['accountId', 'password'] },
        },
        {
            name: 'logout_scope',
            description: guidanceText('guid-ed00f96ff7220cac', 'Revoke the supplied private-scope session token.'),
            inputSchema: { type: 'object', properties: { accessToken: { type: 'string' }, prettyPrint }, required: ['accessToken'] },
        },
        {
            name: 'whoami_scope',
            description: guidanceText('guid-fd514eabbf8fb482', 'Show the scope identity for an access token. Without a token, confirms that only public global and this command center\'s community are visible. With a token, includes family metadata and the private model/agent compatibility scopes; the user storage scope remains host-only.'),
            inputSchema: { type: 'object', properties: { accessToken: { type: 'string' }, prettyPrint } },
        },
        {
            name: 'change_scope_password',
            description: guidanceText('guid-c4321a0896720d5e', 'Change the logged-in account password and revoke all of its existing sessions.'),
            inputSchema: { type: 'object', properties: {
                    accessToken: { type: 'string' }, currentPassword: { type: 'string' }, newPassword: { type: 'string' }, prettyPrint,
                }, required: ['accessToken', 'currentPassword', 'newPassword'] },
        },
        {
            name: 'update_agent_capabilities',
            description: guidanceText('guid-872cdf21b050f8cb', 'Allow the authenticated model owner to replace the capabilities of one of its agent accounts. Existing agent sessions are revoked so the new policy takes effect at the next login.'),
            inputSchema: { type: 'object', properties: {
                    agentId: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string', enum: [...SCOPE_CAPABILITIES] }, minItems: 1 }, accessToken: { type: 'string' }, prettyPrint,
                }, required: ['agentId', 'capabilities', 'accessToken'] },
        },
    ];
}
