import { expect, test } from 'vitest';
import * as model from './roleplay-model.js';

test('small kernel preserves root exports, persisted hashes, IDs and Unicode text contracts', async () => {
  const modulePath = './roleplay-kernel.js';
  const kernel = await import(modulePath).catch(() => undefined);
  expect(kernel, 'shared value kernel must exist independently of the rule engine').toBeDefined();
  for (const name of ['roleplayHash', 'roleplayRevision', 'roleplayId', 'roleplayAccount', 'roleplayText'] as const)
    expect(kernel![name]).toBe(model[name]);
  expect(kernel!.roleplayHash({ b: { y: 3, x: 2 }, a: 1 })).toBe('46828c419428ba79d8942f422c83f507e73d888f31bb4801b14fb07e9ed378b3');
  expect(kernel!.roleplayHash({ z: [{ b: 2, a: 1 }, null, 3], a: '한글' })).toBe('43154565eb3d16281d606a29a7962696773edb6c322e7eb6594cf6a0bd711269');
  expect(kernel!.roleplayRevision({ ...model.initialRoleplay(), requests: { ignored: true } })).toBe('8ffce756b6cf21ec72401a727f25e40a96c35da184b7a4ef18f0a4af7e84ef70');
  expect(kernel!.roleplayId('hero-1')).toBe('hero-1');
  expect(kernel!.roleplayAccount('family.worker_1')).toBe('family.worker_1');
  expect(kernel!.roleplayText('  😀한  ', 2)).toBe('😀한');
  for (const value of ['constructor', 'prototype', '../escape', 'Upper', '', 'a'.repeat(65)]) {
    expect(() => kernel!.roleplayId(value)).toThrow(); expect(() => kernel!.roleplayAccount(value)).toThrow();
  }
  expect(() => kernel!.roleplayText('😀한글', 2)).toThrow();
});
