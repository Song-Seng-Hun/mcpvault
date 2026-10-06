import { expect, test } from 'vitest';
import * as registryModule from './endpoint-registry.js';
import { createServer, getServerRuntime } from '../tests/server-fixture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('typed mixed operation contract drives aliases and discovery across authority modes', async () => {
  const alias = (registryModule as any).operationReadAlias;
  expect(alias).toBeTypeOf('function');
  const root = await mkdtemp(join(tmpdir(), 'operation-contract-'));
  const server = createServer(root, { readOnly: true });
  try {
    const registry = getServerRuntime(server)!.endpointRegistry;
    const pairs = [
      ['skill.candidate', 'read', 'read_skill_candidate', 'create'],
      ['skill.evaluate', 'read', 'read_skill_evaluation', 'run'],
      ['skill.promote', 'preview', 'preview_skill_promotion', 'apply'],
      ['skill.rollback', 'preview', 'preview_skill_rollback', 'apply'],
      ['work.project', 'read', 'read_work_project', 'create'],
      ['work.group', 'read', 'read_work_group', 'join'],
    ];
    for (const [id, read, target, write] of pairs) {
      const endpoint = registry.resolve(id)!;
      expect(alias(endpoint.toolName, read), id).toBe(target);
      expect(alias(endpoint.toolName, write), id).toBeUndefined();
      expect(alias(endpoint.toolName, 'unknown'), id).toBeUndefined();
      expect(alias(endpoint.toolName, { toString: () => read }), id).toBeUndefined();
      for (const authenticated of [false, true]) for (const configured of [false, true]) {
        const listed = registry.list(id, 1, 20000, { readOnly: true, authenticated,
          capabilities: new Set(['write', 'task', 'chat', 'profile']),
          skillEvolutionEnabled: configured,
          ownerActivity: { policyFingerprint: 'test-policy', executionBindingGeneration: 'test-host', eligibility: {
            'skill-evolution': { discover: true, read: true, claim: true, execute: true },
          } },
        }, false).endpoints[0]!;
        expect(listed.operations![write!]!.available, id).toBe(false);
        const needsAuth = read!.includes('preview');
        const needsHost = id!.startsWith('skill.');
        expect(listed.operations![read!]!.available, `${id}/${authenticated}/${configured}`)
          .toBe((!needsAuth || authenticated) && (!needsHost || configured));
      }
    }
    expect(alias('manage_skill_candidate', undefined)).toBe('read_skill_candidate');
    expect(alias('manage_work_project', undefined)).toBe('read_work_project');
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
