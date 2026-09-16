import type { Tool } from '@modelcontextprotocol/server';

const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$', maxLength: 64 };
export function getComputerWorldTool(): Tool {
  return {
    name: 'manage_roleplay_computer',
    description: 'Register and recall computer worlds (컴퓨터 세계관, 환경 등록): multiple PCs/NAS with stable worldId, observed/reported/inferred specs, paths and constraints. Companion to roleplay.world, not fictional game state. Private catalog; no credentials or execution grants. First list; register each computer; bind executionWorldId and targetWorldId to an explicit sessionId; context reads only selected worlds. Example: register desktop, register nas, bind session-a execution=desktop target=nas. Current permissions still apply.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['op'],
      properties: {
        op: { type: 'string', enum: ['list', 'read', 'register', 'update', 'bind', 'context'] },
        accessToken: { type: 'string' }, requestId: id,
        expectedRevision: { type: 'string', description: 'Catalog revision for register/update; sessionRevision for bind. Use missing only to create.' },
        catalogPath: { type: 'string', maxLength: 400, description: 'Existing authorized private scope://agent/ID/Worlds/NAME.md or scope://model/ID/Worlds/NAME.md. Defaults to current agent, otherwise model. Retain this URI for future sessions.' },
        worldId: id, sessionId: id, executionWorldId: id, targetWorldId: id,
        title: { type: 'string', maxLength: 120 },
        facts: { type: 'array', maxItems: 32, items: {
          type: 'object', additionalProperties: false, required: ['key', 'category', 'value', 'basis', 'source', 'observedAt'],
          properties: { key: id, category: { type: 'string', enum: ['hardware', 'software', 'path', 'constraint'] },
            value: { type: 'string', maxLength: 600 }, basis: { type: 'string', enum: ['observed', 'reported', 'inferred'] },
            source: { type: 'string', maxLength: 240 }, observedAt: { type: 'string', maxLength: 40, description: 'ISO timestamp of observation/report, not automatic verification.' } },
        } },
        maxChars: { type: 'integer', minimum: 1000, maximum: 12000, default: 4000 },
        offset: { type: 'integer', minimum: 0, maximum: 4096 },
        version: { type: 'integer', minimum: 0, maximum: 12, description: 'read: 0=current; 1..12 retained earlier snapshots, pinned by expectedCatalogRevision.' },
        expectedCatalogRevision: { type: 'string' }, expectedSessionRevision: { type: 'string' },
      },
      allOf: [
        { if: { properties: { op: { enum: ['register', 'update', 'bind'] } } }, then: { required: ['accessToken', 'requestId', 'expectedRevision'] } },
        { if: { properties: { op: { enum: ['register', 'update'] } } }, then: { required: ['worldId', 'title', 'facts'] } },
        { if: { properties: { op: { const: 'read' } } }, then: { required: ['worldId'] } },
        { if: { properties: { op: { enum: ['bind', 'context'] } } }, then: { required: ['sessionId'] } },
        { if: { properties: { op: { const: 'bind' } } }, then: { required: ['executionWorldId', 'targetWorldId'] } },
      ],
    },
  };
}
