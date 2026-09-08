import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { LlmWikiService } from './llm-wiki.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-workshop-canvas-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const workshopPath = 'Community/Workshops/canvas-workshop.md';
  await fs.writeNote({ path: workshopPath, content: '# Workshop Canvas\n', frontmatter: {
    mcpvault_type: 'workshop', workshop_id: 'canvas-workshop', title: 'Workshop Canvas',
  } });
  const contribution = async (id: string, structured: Record<string, unknown>, body = `# Contribution ${id}\nPRIVATE BODY ${id}\n`, createdAt = `2026-09-08T00:00:0${id.length}Z`) =>
    fs.writeNote({ path: `Community/Workshops/canvas-workshop/Contributions/${id}.md`, content: body, frontmatter: {
      mcpvault_type: 'workshop_contribution', workshop_id: 'canvas-workshop', contribution_id: id,
      account_id: `account-${id}`, created_at: createdAt, structured,
    } });
  return { fs, wiki, workshopPath, contribution };
}

test('workshop Canvas projects only authoritative map nodes and edges with contribution revision guards', async () => {
  const { fs, wiki, workshopPath, contribution } = await fixture();
  await contribution('one', {
    mapNodes: [{ id: 'problem', label: 'Observed problem' }, { id: 'option', label: 'Candidate option' }],
    mapEdges: [{ fromId: 'problem', toId: 'option', label: 'addresses' }],
  });
  const contributionPath = 'Community/Workshops/canvas-workshop/Contributions/one.md';
  const contributionRevision = await fs.readNoteRevision(contributionPath);
  const preview = await wiki.canvasView(undefined, workshopPath, 'workshop', 0, 20, 24000);

  expect(preview.mode).toBe('workshop_canvas');
  expect(preview.sourceRevisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: workshopPath }),
    expect.objectContaining({ path: contributionPath, revision: contributionRevision }),
  ]));
  expect(JSON.stringify(preview)).not.toContain('PRIVATE BODY');
  expect(preview.canvas.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'text', text: 'Observed problem' }),
    expect.objectContaining({ type: 'text', text: 'Candidate option' }),
    expect.objectContaining({ type: 'file', file: contributionPath }),
  ]));
  expect(preview.canvas.edges).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'addresses' })]));

  const saved = await wiki.writeCanvasView(preview.exportAction.arguments);
  expect(saved.snapshotFingerprint).toBe(preview.snapshotFingerprint);
  const health = await wiki.canvasHealth(undefined, 10, 12000);
  expect(health.items).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'fresh', mode: 'workshop' })]));
});

test('workshop Canvas rejects non-workshop roots and structured private references', async () => {
  const { wiki, workshopPath, contribution } = await fixture();
  await expect(wiki.canvasView(undefined, workshopPath, 'moc', 0, 20, 12000)).rejects.toThrow(/note_kind: moc/i);
  await contribution('unsafe', { mapNodes: [{ id: 'secret', label: 'scope://model/codex/Hidden.md' }], mapEdges: [] });
  await expect(wiki.canvasView(undefined, workshopPath, 'workshop', 0, 20, 12000)).rejects.toThrow(/private.*reference|unsafe/i);
});

test('workshop Canvas revalidates selected contribution revisions before export', async () => {
  const { fs, wiki, workshopPath, contribution } = await fixture();
  await contribution('one', { mapNodes: [{ id: 'one', label: 'One' }], mapEdges: [] });
  const preview = await wiki.canvasView(undefined, workshopPath, 'workshop', 0, 20, 24000);
  await contribution('one', { mapNodes: [{ id: 'one', label: 'Changed' }], mapEdges: [] });
  await expect(wiki.writeCanvasView(preview.exportAction.arguments)).rejects.toThrow(/snapshot.*preview|sources changed/i);
  expect(await fs.noteExists(preview.suggestedPath)).toBe(false);
});

test('workshop Canvas bounds structured map nodes and does not infer additional edges', async () => {
  const { wiki, workshopPath, contribution } = await fixture();
  await contribution('one', {
    mapNodes: Array.from({ length: 60 }, (_, index) => ({ id: `node-${index}`, label: `Node ${index}` })),
    mapEdges: [{ fromId: 'node-0', toId: 'node-1', label: 'only explicit edge' }],
  });
  await contribution('two', { mapNodes: [{ id: 'other', label: 'Other' }], mapEdges: [] });
  const preview = await wiki.canvasView(undefined, workshopPath, 'workshop', 0, 50, 24000);
  expect(preview.canvas.nodes.length).toBeLessThanOrEqual(101);
  expect(preview.canvas.edges.filter((edge: { label?: string }) => edge.label === 'only explicit edge')).toHaveLength(1);
  expect(preview.truncated).toBe(true);
});

test('workshop Canvas drops an edge with its late edge-only contribution when fitting the response budget', async () => {
  const { wiki, workshopPath, contribution } = await fixture();
  await contribution('early-source', {
    mapNodes: Array.from({ length: 8 }, (_, index) => ({ id: `early-${index}`, label: `Early map node ${index}: ${'bounded '.repeat(6)}` })),
    mapEdges: [],
  }, undefined, '2026-09-08T00:00:01Z');
  await contribution('late-edge', {
    mapNodes: [],
    mapEdges: Array.from({ length: 80 }, (_, index) => ({
      fromId: `early-${index % 8}`, toId: `early-${(index + 1 + Math.floor(index / 8)) % 8}`,
      label: `late-only edge ${index} ${'x'.repeat(40)}`,
    })),
  }, undefined, '2026-09-08T00:00:02Z');

  const preview = await wiki.canvasView(undefined, workshopPath, 'workshop', 0, 20, 6000);
  expect(preview.sourceRevisions).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Community/Workshops/canvas-workshop/Contributions/early-source.md' })]));
  expect(preview.sourceRevisions).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Community/Workshops/canvas-workshop/Contributions/late-edge.md' })]));
  expect(preview.canvas.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('Early map node 0') })]));
  expect(preview.canvas.edges).not.toEqual(expect.arrayContaining([expect.objectContaining({ label: expect.stringContaining('late-only edge') })]));
});
