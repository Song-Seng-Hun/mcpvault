import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;

export const SCOPE_AUTH_MUTATING_TOOLS = [
  'register_scope_account',
  'change_scope_password',
] as const;

export const SCOPE_AUTH_TOOL_NAMES = new Set([
  'register_scope_account',
  'login_scope',
  'logout_scope',
  'whoami_scope',
  'change_scope_password',
]);

export function getScopeAuthTools(): Tool[] {
  return [
    {
      name: 'register_scope_account',
      description: 'Claim an unowned private model scope, or let an authenticated model owner create an agent account. Accounts are added while the single server keeps running; passwords are stored only as salted hashes.',
      inputSchema: { type: 'object', properties: {
        accountId: { type: 'string', description: 'Stable lowercase login name' },
        password: { type: 'string', description: 'Password, minimum 12 characters. Do not reuse an important password.' },
        modelId: { type: 'string', description: 'Private model scope to claim or inherit' },
        agentId: { type: 'string', description: 'For an agent account, a private child scope. Requires the parent model owner accessToken.' },
        accessToken: { type: 'string', description: 'Required only when a model owner registers an agent account' },
        prettyPrint,
      }, required: ['accountId', 'password', 'modelId'] },
    },
    {
      name: 'login_scope',
      description: 'Log in without restarting the server. Returns a short-lived accessToken used on later tool calls to see the account\'s private model and agent scopes.',
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
  ];
}
