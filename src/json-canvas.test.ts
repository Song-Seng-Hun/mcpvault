import { describe, expect, test } from 'vitest';
import { buildJsonCanvasProjection, validateJsonCanvasDocument, type WikiCanvasNote } from './json-canvas.js';

const notes: WikiCanvasNote[] = [
  { path: 'Knowledge/MOCs/Home.md', publicPath: 'Knowledge/MOCs/Home.md', revision: 'a'.repeat(64), title: 'Home', role: 'root' },
  { path: 'Knowledge/Basics.md', publicPath: 'Knowledge/Basics.md', revision: 'b'.repeat(64), title: 'Basics', role: 'moc_entry', depth: 0, authoredPosition: 1, stage: 1 },
  { path: 'Knowledge/Advanced.md', publicPath: 'Knowledge/Advanced.md', revision: 'c'.repeat(64), title: 'Advanced', role: 'moc_entry', depth: 0, authoredPosition: 2, stage: 2 },
];

describe('JSON Canvas knowledge projections', () => {
  test('uses deterministic IDs, authored placement, and explicit prerequisite edges', () => {
    const input = {
      mode: 'moc' as const,
      notes,
      edges: [
        { fromPath: notes[0]!.path, toPath: notes[1]!.path, label: 'curates', kind: 'authored' as const },
        { fromPath: notes[1]!.path, toPath: notes[2]!.path, label: 'depends_on', kind: 'dependency' as const },
      ],
    };
    const first = buildJsonCanvasProjection(input);
    const second = buildJsonCanvasProjection(input);
    expect(second).toEqual(first);
    expect(first.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.canvas.nodes[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Derived from current Markdown') });
    expect(first.canvas.nodes.at(-1)).toMatchObject({ type: 'file', file: 'Knowledge/MOCs/Home.md', color: '6' });
    expect(first.canvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'depends_on', color: '2', toEnd: 'arrow' }),
    ]));
    expect(() => validateJsonCanvasDocument(first.canvas)).not.toThrow();
  });

  test('rejects duplicate IDs and dangling edges', () => {
    expect(() => validateJsonCanvasDocument({
      nodes: [
        { id: 'same', type: 'file', x: 0, y: 0, width: 100, height: 100, file: 'A.md' },
        { id: 'same', type: 'file', x: 200, y: 0, width: 100, height: 100, file: 'B.md' },
      ],
      edges: [],
    })).toThrow(/unique/);
    expect(() => validateJsonCanvasDocument({
      nodes: [{ id: 'a', type: 'file', x: 0, y: 0, width: 100, height: 100, file: 'A.md' }],
      edges: [{ id: 'edge', fromNode: 'a', toNode: 'missing' }],
    })).toThrow(/existing nodes/);
  });
});
