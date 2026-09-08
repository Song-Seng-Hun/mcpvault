import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { researchWorkPacket, researchWorkIds } from './research-bridge-work.js';
let root: string, fs: FileSystemService;
const researchKey = 'a'.repeat(64);
const principal = { accountId: 'owner', modelId: 'test', agentId: 'owner', role: 'agent' } as any;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'research-work-')); fs = new FileSystemService(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const read = (extra = {}) => researchWorkPacket(fs, new ScopeAccessPolicy(), { researchKey, query: 'Test a cross-domain relation',
  inputs: [{ path: 'Source.md', revision: 'b'.repeat(64) }], principal, ...extra });
test('stable ids reuse the same work, and creation needs an explicit project', async () => {
  expect(researchWorkIds(researchKey)).toEqual(researchWorkIds(researchKey));
  const absent = await read(); expect(absent.state).toBe('needs_project'); expect(absent.createAction).toBeUndefined();
  const r = await read({ projectId: 'research' });
  expect(r.createAction?.arguments).toMatchObject({ projectId: 'research', taskId: researchWorkIds(researchKey).taskId, expectedRevision: 'missing' });
  expect(await fs.noteExists(`Community/Tasks/${researchWorkIds(researchKey).taskId}.md`)).toBe(false);
});
test('existing work routes to its packet and only the current claimant gets the workshop draft', async () => {
  const ids = researchWorkIds(researchKey);
  await fs.writeNote({ path: ids.taskPath, content: 'Claimed work', frontmatter: { mcpvault_type: 'agent_task', task_id: ids.taskId,
    project_id: 'research', status: 'in_progress', assignee_account_id: 'owner', claim_generation: 1 } });
  const own = await read(); expect(own.nextAction?.endpointId).toBe('work.packet'); expect(own.workshopAction?.arguments.workshopId).toBe(ids.workshopId);
  const peer = await read({ principal: { ...principal, accountId: 'peer' } }); expect(peer.workshopAction).toBeUndefined();
});
test('parked and finished work are preserved and never silently recreated', async () => {
  const ids = researchWorkIds(researchKey);
  await fs.writeNote({ path: ids.taskPath, content: 'No compatible mapping', frontmatter: { mcpvault_type: 'agent_task', task_id: ids.taskId, project_id: 'research', status: 'cancelled' } });
  const r = await read(); expect(r.state).toBe('parked'); expect(r.createAction).toBeUndefined(); expect(r.workshopAction).toBeUndefined();
});
test('a private input never produces a public task or workshop draft', async () => {
  const r = await read({ projectId: 'research', inputs: [{ path: 'scope://agent/owner/Private.md', revision: 'b'.repeat(64) }] });
  expect(r.state).toBe('private_research'); expect(r.createAction).toBeUndefined();
  expect(JSON.stringify(r)).not.toContain('Private.md');
});
test('hidden or colliding records cannot be mistaken for absent work', async () => {
  const ids = researchWorkIds(researchKey);
  await fs.writeNote({ path: ids.taskPath, content: 'SECRET_BODY', frontmatter: { mcpvault_type: 'agent_task', moderation_status: 'hidden' } });
  const r = await read({ projectId: 'research' }); expect(r.state).toBe('unavailable'); expect(r.createAction).toBeUndefined();
  expect(JSON.stringify(r)).not.toContain('SECRET_BODY');
});

test('work storage failures produce a generic non-actionable state', async () => {
  vi.spyOn(fs, 'readNoteMetadata').mockRejectedValue(Error('EACCES C:/PRIVATE_HOST_FILE'));
  expect(await read({ projectId: 'research' })).toEqual({ state: 'unavailable' });
});

test('peers and public readers can resume an existing public workshop during review', async () => {
  const ids = researchWorkIds(researchKey);
  await fs.writeNote({ path: ids.taskPath, content: 'Review the results.', frontmatter: { mcpvault_type: 'agent_task', task_id: ids.taskId,
    project_id: 'research', status: 'in_review', assignee_account_id: 'owner', claim_generation: 1 } });
  await fs.writeNote({ path: ids.workshopPath, content: 'Shared research results.', frontmatter: { mcpvault_type: 'workshop', workshop_id: ids.workshopId } });
  for (const principal of [undefined, { accountId: 'peer', modelId: 'test', agentId: 'peer', role: 'agent' }]) {
    const packet = await read({ principal });
    expect(packet.workshopAction).toEqual({ endpointId: 'workshop.read', arguments: { workshopId: ids.workshopId, maxChars: 3000 } });
    expect(packet.createAction).toBeUndefined();
  }
});

test('public workshop resume still checks visibility and never grants a peer creation', async () => {
  const ids = researchWorkIds(researchKey);
  await fs.writeNote({ path: ids.taskPath, content: 'Working.', frontmatter: { mcpvault_type: 'agent_task', task_id: ids.taskId,
    project_id: 'research', status: 'in_progress', assignee_account_id: 'owner', claim_generation: 1 } });
  const peer = { accountId: 'peer', modelId: 'test', agentId: 'peer', role: 'agent' };
  expect((await read({ principal: peer })).workshopAction).toBeUndefined();
  await fs.writeNote({ path: ids.workshopPath, content: 'HIDDEN_WORKSHOP_BODY', frontmatter: { mcpvault_type: 'workshop', workshop_id: ids.workshopId, moderation_status: 'hidden' } });
  const hidden = await read({ principal: peer });
  expect(hidden).toEqual({ state: 'unavailable' });
  expect(JSON.stringify(hidden)).not.toContain('HIDDEN_WORKSHOP_BODY');
});
