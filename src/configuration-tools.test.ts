import { expect, test } from 'vitest';
import { checkReusableConfiguration, getConfigurationTools } from './configuration-tools.js';
const configuration = { id: 'sample', version: '1.0.0', nodes: [
  { id: 'basis', requires: [], excludes: [], cost: 1 },
  { id: 'next', requires: ['basis'], excludes: [], cost: 2 },
], selected: ['basis', 'next'] };
test('learning and procedure bundles use the same prerequisite validator without execution authority', () => {
  for (const kind of ['learning-path', 'procedural-bundle']) {
    const result = checkReusableConfiguration({ kind, configuration, maxChars: 512 });
    expect(result).toMatchObject({ valid: true, selectedCount: 2, totalCost: 3, executable: false, permissionsGranted: false });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
    expect(() => checkReusableConfiguration({ kind, configuration: { ...configuration, selected: ['next'] } })).toThrow(/prerequisite/i);
  }
  expect(getConfigurationTools().map(tool => tool.name)).toEqual(['check_reusable_configuration', 'preview_learning_configuration']);
});
test('configuration validation refuses executable fields, cycles and oversized output requests', () => {
  expect(() => checkReusableConfiguration({ kind: 'shell', configuration })).toThrow();
  expect(() => checkReusableConfiguration({ kind: 'learning-path', configuration: { ...configuration, execute: 'run' } })).toThrow();
  expect(() => checkReusableConfiguration({ kind: 'learning-path', configuration, maxChars: 20 })).toThrow();
  expect(() => checkReusableConfiguration({ kind: 'learning-path', configuration: { ...configuration, nodes: configuration.nodes.map(n => ({ ...n, requires: [n.id] })) } })).toThrow(/cycle/);
});

test('unreachable diagnostics are bounded by the full response budget, with honest truncation', () => {
  const nodes = [{ id: 'base', requires: [], excludes: [], cost: 0 }, ...Array.from({length:20}, (_, i) => ({id:`broken-${i}`, requires:['base'], excludes:['base'], cost:1}))];
  const result = checkReusableConfiguration({kind:'procedural-bundle', configuration:{id:'bounded', version:'1.0.0', nodes, selected:[]}, maxChars:512}) as any;
  expect(result).toMatchObject({valid:true, nodeCount:21, diagnostics:{advisory:true, truncated:true}});
  expect(result.diagnostics.items.length).toBeLessThanOrEqual(8);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
});
