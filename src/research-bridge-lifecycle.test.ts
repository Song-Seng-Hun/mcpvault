import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';
import { WorkService } from './work-service.js';
import { IdeationService } from './ideation.js';
import { ResearchBridgeService } from './research-bridge.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('research drafts use real work claim/retry and resume one workshop after interruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-lifecycle-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const refs = new ReferenceService(fs, access), auth = new ScopeAuthService(root);
  const owner = (await auth.register({ accountId: 'owner', modelId: 'owner', password: 'fixture-password-only' })).principal;
  const peer = (await auth.register({ accountId: 'peer', modelId: 'peer', password: 'fixture-password-only' })).principal;
  const tasks = new AgentTaskService(fs, refs, auth), work = new WorkService(fs, refs, auth, tasks);
  await work.project({ op: 'create', principal: owner, projectId: 'research', title: 'Research', goal: 'Check a mapping',
    allowedWork: ['general'], completionCriteria: ['Preserve evidence'], participants: ['peer'], requestId: 'research-project' });
  for (const [path, domain] of [['Focus.md', 'math'], ['Other.md', 'physics']]) {
    await fs.writeNote({ path: path!, content: 'Test a limited mapping.', frontmatter: { note_kind: 'hypothesis', domain, methods: ['symmetry'] } });
  }
  const params = { focusPath: 'Focus.md', query: 'Which conditions preserve symmetry?', projectId: 'research', maxChars: 12000 };
  const bridge = new ResearchBridgeService(fs, access);
  const candidate = (await bridge.candidates({ ...params, principal: owner })).candidates[0]!;
  const draft = candidate.work!.createAction!.arguments;
  const creations = await Promise.all([tasks.create({ ...draft, principal: owner } as any), tasks.create({ ...draft, principal: owner } as any)]);
  expect(creations[0].taskId).toBe(creations[1].taskId);
  const taskId = creations[0].taskId, taskPath = `Community/Tasks/${taskId}.md`;
  const before = await fs.readNote(taskPath);
  const claims = await Promise.allSettled([owner, peer].map(principal => work.claim({ principal, taskId, op: 'start',
    expectedRevision: before.revision, expectedGeneration: before.frontmatter.claim_generation, reason: 'Run one check', requestId: `claim-${principal.accountId}` })));
  expect(claims.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const winner = claims[0]!.status === 'fulfilled' ? owner : peer;
  const loser = winner === owner ? peer : owner;
  const selected = (await bridge.candidates({ ...params, principal: winner, publicRequestId: 'research-public-run' })).candidates[0]!;
  expect(selected.work!.nextAction!.endpointId).toBe('work.packet');
  expect((await bridge.candidates({ ...params, principal: loser })).candidates[0]!.work!.workshopAction).toBeUndefined();
  const workshopDraft = selected.work!.workshopAction!.arguments;
  const ideation = new IdeationService(fs, refs);
  const claimNote = await fs.readNote(taskPath);
  await work.claim({ principal: winner, taskId, op: 'release', expectedRevision: claimNote.revision,
    expectedGeneration: claimNote.frontmatter.claim_generation, reason: 'Interrupted before workshop', requestId: 'release-before-workshop' });
  await expect(ideation.createWorkshop({ ...workshopDraft, principal: winner } as any)).rejects.toThrow(/claim|revision|research|progress/i);
  const released = await fs.readNote(taskPath);
  await work.claim({ principal: winner, taskId, op: 'start', expectedRevision: released.revision,
    expectedGeneration: released.frontmatter.claim_generation, reason: 'Resume investigation', requestId: 'resume-after-release' });
  const resumedDraft = (await bridge.candidates({ ...params, principal: winner, publicRequestId: 'research-resumed-run' })).candidates[0]!.work!.workshopAction!.arguments;
  const workshops = await Promise.all([ideation.createWorkshop({ ...resumedDraft, principal: winner } as any), ideation.createWorkshop({ ...resumedDraft, principal: winner } as any)]);
  expect(workshops[0].workshopId).toBe(workshops[1].workshopId);
  const resumedFs = new FileSystemService(root);
  const resumed = await new ResearchBridgeService(resumedFs, access).candidates({ ...params, principal: winner });
  expect(resumed.candidates[0]!.work!.workshopAction!.endpointId).toBe('workshop.read');
  expect(await resumedFs.countNotes({ pathPrefix: 'Community/Workshops', filters: { mcpvault_type: 'workshop' } })).toBe(1);
  expect(await resumedFs.countNotes({ pathPrefix: 'Community/Tasks', filters: { mcpvault_type: 'agent_task' } })).toBe(1);
});
