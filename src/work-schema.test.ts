import { expect, test } from 'vitest';
import { EndpointRegistry } from './endpoint-registry.js';
import { getAgentTaskTools } from './agent-task-tools.js';
import { getWorkTools } from './work-tools.js';

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
