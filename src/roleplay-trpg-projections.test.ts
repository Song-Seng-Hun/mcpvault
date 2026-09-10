import { expect, test } from 'vitest';
import { initialRoleplay, roleplayHash, roleplayRevision } from './roleplay-model.js';
import { defaultTrpgRuleset, newTrpgSheet } from './roleplay-trpg.js';
import * as projection from './roleplay-trpg-projections.js';
import { validateJsonCanvasDocument } from './json-canvas.js';
import { PathFilter } from './pathfilter.js';

test('sheet, file-linked managed skill Canvas and Bases are deterministic disposable artifacts', () => {
  const state = initialRoleplay(), ruleset = defaultTrpgRuleset();
  state.trpg = { ruleset, fingerprint: roleplayHash(ruleset), sheets: { alice: newTrpgSheet(ruleset) }, encounters: {} };
  const files = projection.trpgArtifacts(state, 'alice');
  expect(files.map(f => f.path)).toEqual(['Community/Roleplay/Sheets/alice.md', 'Community/Roleplay/Sheets/alice.canvas', 'Community/Roleplay/Sheets/alice.base']);
  expect(files[0]!.content).toContain('HP: 12 / 12'); expect(files[0]!.content).toContain(roleplayRevision(state));
  const canvas = JSON.parse(files[1]!.content); expect(canvas.nodes.every((n: any) => n.type === 'file' && n.file === files[0]!.path)).toBe(true);
  expect(canvas.edges).toHaveLength(2); expect(canvas.mcpvault.sourceRevision).toBe(roleplayRevision(state));
  expect(files[2]!.content).toContain('type: table'); expect(projection.trpgArtifacts(state, 'alice')).toEqual(files);
  expect(() => projection.trpgArtifacts(state, '../secret')).toThrow();
});

test('managed artifact seals reject edits and Canvas edges remain unique and bounded', () => {
  const state = initialRoleplay(), ruleset = defaultTrpgRuleset();
  ruleset.skills = Array.from({ length: 64 }, (_, i) => ({ ...ruleset.skills[0]!, id: `s-${i}`, requires: Array.from({ length: Math.min(i, 16) }, (_, j) => `s-${j}`) }));
  ruleset.initialSkills = ['s-0'];
  state.trpg = { ruleset, fingerprint: roleplayHash(ruleset), sheets: { alice: newTrpgSheet(ruleset) }, encounters: {} };
  const files = projection.trpgArtifacts(state, 'alice');
  for (const file of files) {
    expect(projection.trpgArtifactSource(file, 'alice')).toBe(roleplayRevision(state));
    expect(projection.trpgArtifactSource({ ...file, content: file.content + 'edited' }, 'alice')).toBeUndefined();
    expect(projection.trpgArtifactSource(file, 'bob')).toBeUndefined();
  }
  const canvas = JSON.parse(files[1]!.content);
  expect(() => validateJsonCanvasDocument(canvas)).not.toThrow();
  expect(canvas.edges).toHaveLength(300); expect(canvas.mcpvault.omittedEdges).toBeGreaterThan(0);
  expect(new Set(canvas.edges.map((e: any) => e.id)).size).toBe(300);
});

test('valid device-like character IDs have collision-free portable artifact names', () => {
  const state = initialRoleplay(), ruleset = defaultTrpgRuleset();
  const ids = ['con', 'aux', 'prn', 'nul', 'com1', 'lpt9', 'con-hero'];
  state.trpg = { ruleset, fingerprint: roleplayHash(ruleset), sheets: Object.fromEntries(ids.map(id => [id, newTrpgSheet(ruleset)])), encounters: {} };
  const files = ids.flatMap(id => {
    const artifacts = projection.trpgArtifacts(state, id);
    for (const artifact of artifacts) {
      expect(new PathFilter().isAllowed(artifact.path)).toBe(true);
      expect(projection.trpgArtifactSource(artifact, id)).toBe(roleplayRevision(state));
    }
    expect(JSON.parse(artifacts[1]!.content).nodes[0].file).toBe(artifacts[0]!.path);
    expect(artifacts[2]!.content).toContain(artifacts[0]!.path);
    return artifacts;
  });
  expect(new Set(files.map(f => f.path)).size).toBe(files.length);
});
