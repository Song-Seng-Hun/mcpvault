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
  expect(getConfigurationTools()).toHaveLength(1);
});
test('configuration validation refuses executable fields, cycles and oversized output requests', () => {
  expect(() => checkReusableConfiguration({ kind: 'shell', configuration })).toThrow();
  expect(() => checkReusableConfiguration({ kind: 'learning-path', configuration: { ...configuration, execute: 'run' } })).toThrow();
  expect(() => checkReusableConfiguration({ kind: 'learning-path', configuration, maxChars: 20 })).toThrow();
  expect(() => checkReusableConfiguration({ kind: 'learning-path', configuration: { ...configuration, nodes: configuration.nodes.map(n => ({ ...n, requires: [n.id] })) } })).toThrow(/cycle/);
});
