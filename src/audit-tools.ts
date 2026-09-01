import type { Tool } from '@modelcontextprotocol/server';

const prettyPrint = { type: 'boolean', description: 'Format JSON response with indentation', default: false } as const;
const accessToken = { type: 'string', description: 'Token from login_scope; required.' } as const;

export function getAuditTools(): Tool[] {
  return [{
    name: 'list_audit_events',
    description: 'Read your own bounded metadata-only MCP security audit events. It records tool, target identifier, attempt/error, and timestamp, never note bodies, passwords, or access tokens.',
    inputSchema: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      includeErrors: { type: 'boolean', description: 'Include denied/error events (default: false)' },
      accessToken, prettyPrint,
    }, required: ['accessToken'] },
  }];
}
