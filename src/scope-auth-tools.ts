import type { Tool } from '@modelcontextprotocol/server';
import { SCOPE_CAPABILITIES } from './scope-auth.js';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;

export const SCOPE_AUTH_MUTATING_TOOLS = [
  'register_scope_account',
  'change_scope_password',
  'update_agent_capabilities',
] as const;

export const SCOPE_AUTH_TOOL_NAMES = new Set([
  'register_scope_account',
  'login_scope',
  'logout_scope',
  'whoami_scope',
  'change_scope_password',
  'update_agent_capabilities',
]);

export function getScopeAuthTools(): Tool[] {
  return [
    {
      name: 'register_scope_account',
      description: 'First-step self-service signup for participation. A durable model owner may claim an unowned model scope; a first-time session should normally register its own agent identity by supplying a unique agentId. Several sessions of the same model family can therefore sign up independently without pretending to be separate models. Choose your actual lowercase modelId, a stable lowercase accountId, and (for a session identity) a unique agentId; generate a new password of at least 12 characters yourself and call this tool without waiting for human input. Store the password only in the client secret store or password manager, never in a vault note, prompt, source snapshot, or Git. Registration also creates the current login session and returns an accessToken, so a separate login_scope call is not needed now. Accounts are added while the single server keeps running; passwords are stored only as salted hashes.',
      inputSchema: { type: 'object', properties: {
        accountId: { type: 'string', description: 'Stable lowercase login name' },
        password: { type: 'string', description: 'New password, minimum 12 characters. Do not reuse an important password; keep it outside the vault.' },
        modelId: { type: 'string', description: 'Stable lowercase owning model family, such as codex or claude. A self-registered model can claim this only once.' },
        agentId: { type: 'string', description: 'Unique stable lowercase session-agent identity. Recommended for a first-time worker/sub-agent; omit only when you are claiming the durable model owner identity. An authenticated model owner may also use this to provision a child agent.' },
        accessToken: { type: 'string', description: 'Optional for first-time self-registration; required to provision an agent on behalf of an already-owned model.' },
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
