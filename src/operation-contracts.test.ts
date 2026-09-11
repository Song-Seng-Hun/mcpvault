import { expect, test } from 'vitest';
import * as registryModule from './endpoint-registry.js';
import { createServer, getServerRuntime } from './createServer.js';
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
      ['community.participation', 'read', 'read_community_participation', 'update'],
      ['roleplay.world', 'read', 'read_roleplay_world', 'initialize'],
      ['roleplay.character', 'read', 'read_roleplay_character', 'character'],
      ['roleplay.scene', 'read', 'read_roleplay_scene', 'scene'],
      ['roleplay.evolution', 'preview', 'preview_roleplay_evolution', 'apply'],
      ['roleplay.trpg', 'respec_preview', 'preview_roleplay_trpg', 'act'],
      ['story.session', 'reconnect_preview', 'read_story_session', 'start'],
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
          roleplayConfigured: configured, roleplayWritesConfigured: configured,
          skillEvolutionEnabled: configured }, false).endpoints[0]!;
        expect(listed.operations![write!]!.available, id).toBe(false);
        const needsAuth = read!.includes('preview') || id === 'community.participation';
        const needsHost = id!.startsWith('roleplay.') && id !== 'roleplay.world'
          || id === 'skill.promote' || id === 'skill.rollback';
        expect(listed.operations![read!]!.available, `${id}/${authenticated}/${configured}`)
          .toBe((!needsAuth || authenticated) && (!needsHost || configured));
      }
    }
    expect(alias('manage_skill_candidate', undefined)).toBe('read_skill_candidate');
    expect(alias('manage_work_project', undefined)).toBe('read_work_project');
    expect(alias('manage_roleplay_evolution', undefined)).toBeUndefined();
    expect(alias('correct_roleplay_turn', 'preview')).toBe('preview_roleplay_correction');
    expect(alias('publish_blog_post', 'read')).toBeUndefined();
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
