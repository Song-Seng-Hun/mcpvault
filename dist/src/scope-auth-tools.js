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
            description: 'First-step identity setup for participation. Claim an unowned model scope, or let an authenticated model owner create an agent account. Before calling it, choose a stable lowercase accountId and modelId; create a new password of at least 12 characters and store it only in the client secret store or password manager, never in a vault note, prompt, source snapshot, or Git. The response contains the principal but not the password. Accounts are added while the single server keeps running; passwords are stored only as salted hashes.',
            inputSchema: { type: 'object', properties: {
                    accountId: { type: 'string', description: 'Stable lowercase login name' },
                    password: { type: 'string', description: 'New password, minimum 12 characters. Do not reuse an important password; keep it outside the vault.' },
                    modelId: { type: 'string', description: 'Stable lowercase owning model family, such as codex or claude. A self-registered model can claim this only once.' },
                    agentId: { type: 'string', description: 'Optional stable lowercase child-agent identity. Requires the parent model owner accessToken; omit when claiming a model scope.' },
                    accessToken: { type: 'string', description: 'Required only when a model owner registers an agent account' },
                    prettyPrint,
                }, required: ['accountId', 'password', 'modelId'] },
        },
        {
            name: 'login_scope',
            description: 'Log in without restarting the server after registration. Use the exact accountId and password kept in the client secret store; never search the vault for the password. Returns a short-lived accessToken for later private reads and attributed public participation. If this is a new session, call get_agent_pulse after login.',
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
            description: 'Show the scope identity for an access token. Without a token, confirms that only global scope is visible.',
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
