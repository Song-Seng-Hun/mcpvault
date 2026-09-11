import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { IdeationService } from './ideation.js';
import type { ScopePrincipal } from './scope-auth.js';

let vault: string;

const principal: ScopePrincipal = { accountId: 'idea-owner', userId: 'idea-owner', modelId: 'codex', agentId: 'idea-agent', role: 'agent' };
const parentPath = 'Community/Ideas/parent.md';

beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-ideation-revision-')); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

async function parent(fs: FileSystemService) {
  return fs.writeNoteWithReceipt({
    path: parentPath, content: '# Parent\n\nSeed\n',
    frontmatter: { mcpvault_type: 'idea', idea_id: 'parent', title: 'Parent', author: 'idea-agent', status: 'seed', parent_ideas: [] },
    expectedRevision: 'missing',
  });
}

function references(onValidate?: () => Promise<void>) {
  return { validateAndNormalize: async () => { await onValidate?.(); return []; } } as any;
}

async function childCount(fs: FileSystemService) {
  return fs.countNotes({ pathPrefix: 'Community/Ideas', filters: { mcpvault_type: 'idea' } });
}

test('branching guards the exact parent through reference validation and leaves no child on parent drift', async () => {
  const fs = new FileSystemService(vault);
  const created = await parent(fs);
  let changed = false;
  const service = new IdeationService(fs, references(async () => {
    if (changed) return;
    changed = true;
    const current = await fs.readNote(parentPath);
    await fs.writeNote({ path: parentPath, content: current.content, frontmatter: { ...current.frontmatter, moderation_status: 'hidden' }, expectedRevision: current.revision });
  }));

  await expect(service.branchIdea({ principal, parentIdeaId: 'parent', title: 'Child', seed: 'Branch safely.', references: [], expectedParentRevision: created.revision } as any)).rejects.toThrow(/parent|revision|changed/i);
  expect(await childCount(fs)).toBe(1);
});

test('branch retry replays one guarded child and rejects a changed payload', async () => {
  const fs = new FileSystemService(vault);
  const created = await parent(fs);
  const service = new IdeationService(fs, references());
  const request = { principal, parentIdeaId: 'parent', title: 'Child', seed: 'Branch safely.', references: [], expectedParentRevision: created.revision, requestId: 'branch-retry' } as any;

  const first = await service.branchIdea(request);
  const replay = await service.branchIdea(request);
  expect(replay.ideaId).toBe(first.ideaId);
  expect(await childCount(fs)).toBe(2);
  await expect(service.branchIdea({ ...request, title: 'Changed child' })).rejects.toThrow(/requestId|payload/i);
});

test('branching keeps hidden parents unavailable without creating a child', async () => {
  const fs = new FileSystemService(vault);
  const created = await parent(fs);
  const hidden = await fs.readNote(parentPath);
  await fs.writeNote({ path: parentPath, content: hidden.content, frontmatter: { ...hidden.frontmatter, moderation_status: 'hidden' }, expectedRevision: hidden.revision });
  const service = new IdeationService(fs, references());

  await expect(service.branchIdea({ principal, parentIdeaId: 'parent', title: 'Hidden child', seed: 'Must not expose the parent.', expectedParentRevision: created.revision } as any)).rejects.toThrow(/unavailable/i);
  expect(await childCount(fs)).toBe(1);
});

test('evaluation pins the source revision, rejects source races, and exposes current stale and legacy states', async () => {
  const fs = new FileSystemService(vault);
  const initial = await parent(fs);
  let race = true;
  const racing = new IdeationService(fs, references(async () => {
    if (!race) return;
    race = false;
    const current = await fs.readNote(parentPath);
    await fs.writeNote({ path: parentPath, content: current.content, frontmatter: { ...current.frontmatter, moderation_status: 'hidden' }, expectedRevision: current.revision });
  }));
  const scores = { principal, ideaId: 'parent', novelty: 4, usefulness: 4, feasibility: 3, risk: 2, evidenceQuality: 4, rationale: 'Bounded assessment.' };

  await expect(racing.evaluateIdea({ ...scores, expectedIdeaRevision: initial.revision } as any)).rejects.toThrow(/idea|revision|changed/i);
  expect(await fs.noteExists('Community/Ideas/parent/Evaluations/idea-agent.md')).toBe(false);

  const hiddenParent = await fs.readNote(parentPath);
  const restored = { ...hiddenParent.frontmatter };
  delete restored.moderation_status;
  await fs.writeNote({ path: parentPath, content: hiddenParent.content, frontmatter: restored, expectedRevision: hiddenParent.revision });
  const currentParent = await fs.readNote(parentPath);
  const service = new IdeationService(fs, references());
  const evaluation = await service.evaluateIdea({ ...scores, expectedIdeaRevision: currentParent.revision } as any);
  const current = await service.readIdea({ ideaId: 'parent' }) as any;
  expect(current.evaluations[0]).toMatchObject({
    path: 'Community/Ideas/parent/Evaluations/idea-agent.md', revision: evaluation.revision,
    evaluatedIdeaRevision: currentParent.revision, evaluatedIdeaState: 'current',
  });
  const updated = await service.evaluateIdea({ ...scores, rationale: 'Updated bounded assessment.', expectedRevision: evaluation.revision, expectedIdeaRevision: currentParent.revision } as any);
  expect(updated.revision).not.toBe(evaluation.revision);

  const drifted = await fs.readNote(parentPath);
  await fs.writeNote({ path: parentPath, content: drifted.content, frontmatter: { ...drifted.frontmatter, later_drift: true }, expectedRevision: drifted.revision });
  const stale = await service.readIdea({ ideaId: 'parent' }) as any;
  expect(stale.evaluations.find((item: any) => item.evaluator === 'idea-agent').evaluatedIdeaState).toBe('stale');

  await fs.writeNote({ path: 'Community/Ideas/parent/Evaluations/legacy.md', content: 'Old assessment.\n', frontmatter: { mcpvault_type: 'idea_evaluation', idea_id: 'parent', evaluator: 'legacy', novelty: 3, usefulness: 3, feasibility: 3, risk: 3, evidence_quality: 3 }, expectedRevision: 'missing' });
  const legacy = await service.readIdea({ ideaId: 'parent' }) as any;
  expect(legacy.evaluations.find((item: any) => item.evaluator === 'legacy').evaluatedIdeaState).toBe('unpinned');
  await expect(service.evaluateIdea({ ...scores, expectedRevision: updated.revision, expectedIdeaRevision: initial.revision } as any)).rejects.toThrow(/idea|revision|changed/i);
});
