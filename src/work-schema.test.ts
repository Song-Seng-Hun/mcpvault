import { expect, test } from 'vitest';
import { EndpointRegistry } from './endpoint-registry.js';
import { getAgentTaskTools } from './agent-task-tools.js';
import { getWorkTools } from './work-tools.js';
import { WORK_MUTATING_TOOLS } from './work-tools.js';
import { isManagedCommunityPath } from './moderation-policy.js';
import { GUIDANCE_DEFINITIONS } from './guidance-defaults.generated.js';

test('new dynamic endpoint descriptions are included in Vault-backed guidance', () => {
  expect(GUIDANCE_DEFINITIONS.some(d => d.template.startsWith('Voluntary persistent subject group:'))).toBe(true);
  expect(GUIDANCE_DEFINITIONS.some(d => d.template.startsWith('Bounded advisory gaps in declared project perspectives'))).toBe(true);
});

test('group discovery preserves anonymous read while writes and managed notes remain protected', () => {
  const registry = new EndpointRegistry();
  registry.setTools(getWorkTools(), { manage_work_group: 'task' }, new Set(WORK_MUTATING_TOOLS));
  const found = registry.list('work.group', 1, 12000, { readOnly: true, authenticated: false, capabilities: new Set() }, false).endpoints[0] as any;
  expect(found.endpointId).toBe('work.group');
  expect(found.operations.read.available).toBe(true);
  expect(found.operations.join.available).toBe(false);
  expect(isManagedCommunityPath('Community/Groups/research.md')).toBe(true);
  expect(registry.resolve('work.coverage')).toBeDefined();
});

test('mixed create/update schemas do not advertise resetting defaults on partial edits', () => {
  const update = getAgentTaskTools().find(tool => tool.name === 'update_agent_task')!.inputSchema.properties as any;
  const project = getWorkTools().find(tool => tool.name === 'manage_work_project')!.inputSchema.properties as any;
  expect(update.workKind.default).toBeUndefined();
  expect(project.wipLimit.default).toBeUndefined();
  expect(project.personalWipLimit.default).toBeUndefined();
});

test('project task requirements survive compact endpoint schema discovery', () => {
  const registry = new EndpointRegistry();
  const tools = getAgentTaskTools().map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, description: 'context '.repeat(2000) } }));
  registry.setTools(tools, { create_agent_task: 'task', update_agent_task: 'task' }, new Set(['create_agent_task', 'update_agent_task']));
  for (const [id, required] of [['mcp.create_agent_task', ['requestId']], ['mcp.update_agent_task', ['requestId', 'expectedGeneration']]] as const) {
    const result = registry.list(id, 1, 12000, { readOnly: false, authenticated: true, capabilities: new Set(['task']) }, false);
    const descriptor = result.endpoints[0] as any;
    expect(descriptor.schemaCompacted).toBe(true);
    expect(descriptor.input.allOf).toContainEqual({ if: { required: ['projectId'] }, then: { required: [...required] } });
  }
});
