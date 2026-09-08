import type { Tool } from '@modelcontextprotocol/server';

export const ENTERPRISE_FEDERATION_MUTATING_TOOLS = ['public_federation_pull', 'public_federation_retry'] as const;
export function getEnterpriseFederationTools(): Tool[] {
  return [
    { name: 'public_federation_pull', description: 'Import one bounded page of verified public community activities from the configured Hub. Local hiding and origin tombstones remain distinct.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
    { name: 'public_federation_retry', description: 'Retry the authenticated persistent agent\'s durable public outbox. Pending and rejected records are never reported as synchronized.', inputSchema: { type: 'object', properties: {} } },
    { name: 'public_federation_get', description: 'Read one verified public federation object by its permanent ID.', inputSchema: { type: 'object', properties: { objectId: { type: 'string' }, maxChars: { type: 'integer', minimum: 512, maximum: 20000 } }, required: ['objectId'] } },
    { name: 'public_federation_list', description: 'Read a bounded list of visible public federation objects.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, maxChars: { type: 'integer', minimum: 512, maximum: 20000 }, type: { type: 'string', enum: ['actor', 'profile', 'post', 'comment'] }, postId: { type: 'string' }, origin: { type: 'string' }, after: { type: 'string' } } } },
  ];
}
