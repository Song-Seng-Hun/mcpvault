import { expect, test } from 'vitest';
import { createServer, getServerRuntime } from '../tests/server-fixture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('story catalog has nine bounded contracts with operation-specific owner-admitted reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'story-contract-'));
  const server = createServer(root, { readOnly: true });
  try {
    const registry = getServerRuntime(server)!.endpointRegistry;
    const ownerActivity = { policyFingerprint: 'fixture-consent', executionBindingGeneration: 'fixture-runtime',
      eligibility: { roleplay: { discover: true, read: true, claim: true, execute: true } } };
    for (const name of ['project', 'artifact', 'sequence', 'context', 'review', 'adopt', 'session', 'export', 'visual']) {
      const endpoint = registry.resolve(`story.${name}`);
      expect(endpoint, name).toBeDefined();
      expect(endpoint!.url).toBe(`/api/endpoint/story.${name}`);
      expect(registry.resolveRoute('POST', `/api/stories/novel/${name}`)).toBeUndefined();
      expect(endpoint!.input).toMatchObject({ type: 'object', additionalProperties: false, required: ['projectId'] });
      const properties = endpoint!.input.properties as any;
      expect(properties.maxChars.maximum).toBe(12000);
      expect(properties.ownerAccountId).toBeUndefined();
      expect(properties.principal).toBeUndefined();
      const withoutConsent = registry.list(`story.${name}`, 1, 20000, { readOnly: true, authenticated: false, capabilities: new Set() }, false).endpoints[0]!;
      expect(withoutConsent.available).toBe(false);
      if (name !== 'adopt') expect(withoutConsent.reason).toBe('owner consent required');
      const listed = registry.list(`story.${name}`, 1, 20000, { readOnly: true, authenticated: false, capabilities: new Set(), ownerActivity }, false).endpoints[0]!;
      if (name === 'adopt') expect(listed.state).toBe('disabled');
      else {
        expect(listed.available).toBe(true);
        expect(listed.requires).toEqual([]);
        if (name !== 'context') {
          expect(listed.operations!.read).toMatchObject({ available: true, requires: [] });
          const op = name === 'visual' ? 'propose' : name === 'export' ? 'write' : name === 'session' ? 'start' : name === 'sequence' ? 'update' : 'create';
          expect(listed.operations![op]).toMatchObject({ state: 'disabled', requires: ['write', 'task'] });
        }
      }
    }
    const artifact = registry.resolve('story.artifact')!.input.properties as any;
    expect(artifact.sources.items).toMatchObject({ additionalProperties: false, required: ['artifactId', 'revision'] });
    expect(artifact.data.properties.graph.properties.nodes.items.additionalProperties).toBe(false);
    expect(artifact.data.properties.images.items.additionalProperties).toBe(false);
    expect(artifact.data.properties.blocks.items.additionalProperties).toBe(false);
    expect((registry.resolve('story.export')!.input.properties as any).op.default).toBe('preview');
    expect(artifact.data.properties.order.type).toBe('integer');
    expect(artifact.data.properties.durationSeconds.maximum).toBe(86400);
    expect(artifact.data.properties.visual.properties.events.maxItems).toBe(64);
    expect(artifact.data.properties.visual.properties.events.items.additionalProperties).toBe(false);
    const visual = registry.resolve('story.visual')!.input.properties as any;
    expect(visual.op.default).toBe('read');
    expect(visual.intent.oneOf).toHaveLength(3);
    expect(visual.replacements.maxItems).toBe(32);
    const restricted = registry.list('story.artifact', 1, 20000, { readOnly: false, authenticated: true, capabilities: new Set(['task']), ownerActivity }, false).endpoints[0]!;
    expect(restricted.available).toBe(true);
    expect(restricted.operations!.create).toMatchObject({ available: false, state: 'locked', requires: ['write', 'task'] });
    const session = registry.resolve('story.session')!.input.properties as any;
    expect(session.op.enum).toContain('reconnect_preview');
    expect(session.includeGitHistory.type).toBe('boolean');
    expect(session.reconnectProofFingerprint.pattern).toBe('^[a-f0-9]{64}$');
    const anonymous = registry.list('story.session', 1, 20000, { readOnly: true, authenticated: false, capabilities: new Set(), ownerActivity }, false).endpoints[0]!;
    expect(anonymous.operations!.reconnect_preview).toMatchObject({ available: false, state: 'locked', requires: ['write', 'task'] });
    const authorized = registry.list('story.session', 1, 20000, { readOnly: true, authenticated: true, capabilities: new Set(['write', 'task']), ownerActivity }, false).endpoints[0]!;
    expect(authorized.operations!.reconnect_preview).toMatchObject({ available: true, state: 'ready', requires: ['write', 'task'] });
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
