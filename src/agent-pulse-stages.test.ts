import { expect, test } from 'vitest';
import { AgentPulseService } from './agent-pulse.js';

const principal = { accountId: 'pulse-worker', modelId: 'codex', role: 'model' } as const;
const emptyTasks = { tasks: [], total: 0, statusCounts: { in_progress: 0, accepted: 0, proposed: 0, blocked: 0 } };

// Boundary doubles isolate scheduling; the selected nextAction and coverage are
// outputs of the real Pulse service. Real Work/task admission has separate tests.
function fixture(values: Record<string, unknown> = {}, failures: string[] = [], ownerConsent = true) {
  const calls: string[] = [];
  const read = (name: string, fallback: unknown) => async () => {
    calls.push(name);
    if (failures.includes(name)) throw Error('private backend path for ' + name);
    return name in values ? values[name] : fallback;
  };
  const service = new AgentPulseService(
    { listAssignedOpen: read('tasks', emptyTasks) } as any,
    { read: read('continuity', { exists: false }) } as any,
    { reviewQueue: read('reviewQueue', { items: [], total: 0 }), inbox: read('inbox', { items: [], total: 0 }),
      readModelGeneration: () => 0, reviewPacket: read('maintenance', {}), synthesisCandidates: read('synthesis', { items: [] }) } as any,
    { pulse: read('work', { coverage: 'loaded' }) } as any,
    { nextAction: read('skills', undefined) } as any,
    // Scheduling tests explicitly admit optional reads; no production grant.
    async () => ownerConsent ? ({ run: async <T>(reader: () => Promise<T>) => reader(),
      revalidate: async () => {}, assertFresh: () => {} }) : undefined,
  );
  return { calls, service };
}

test('without owner consent, scheduling never reads optional activity backends', async () => {
  const f = fixture({}, [], false);
  const value = await f.service.get({ principal, skillId: 'safe-edit' });
  expect(value.nextAction.tool).toBe('wiki.home');
  for (const source of ['skills']) {
    expect(f.calls).not.toContain(source);
  }
});

test('checkpoint reads only continuity, even if every lower-priority backend fails', async () => {
  const f = fixture({ continuity: { exists: true } }, ['work', 'tasks', 'reviewQueue', 'inbox', 'maintenance', 'skills']);
  const value = await f.service.get({ principal, skillId: 'safe-edit' });
  expect(value.nextAction).toMatchObject({ tool: 'continuity.resume' });
  expect(f.calls).toEqual(['continuity']);
  expect(value.coverage).toMatchObject({ continuity: { state: 'loaded' }, work: { state: 'skipped' }, skills: { state: 'skipped' } });
  expect(value.signals).not.toHaveProperty('assignedOpenTasks');
  expect(value.identity).not.toHaveProperty('xp');
});

test.each(['continuity', 'work', 'tasks'])('required %s failure does not enable lower-priority fallback', async source => {
  const f = fixture({}, [source]);
  await expect(f.service.get({ principal })).rejects.toThrow();
  expect(f.calls.at(-1)).toBe(source);
  expect(f.calls).not.toContain('reviewQueue');
});

test('unavailable Work coverage does not masquerade as no assigned work', async () => {
  const f = fixture({ work: { coverage: 'unavailable' } });
  await expect(f.service.get({ principal })).rejects.toThrow(/work.*unavailable/i);
  expect(f.calls).toEqual(['continuity', 'work']);
});

test('capability-limited research sessions skip inaccessible task guidance without widening authority', async () => {
  const f = fixture({ work: { coverage: 'unavailable' } });
  const research = { ...principal, capabilities: ['write', 'comment', 'profile', 'journal'] as const };
  const pulse = await f.service.get({ principal: research });
  expect(pulse.nextAction).toBeDefined();
  expect(pulse.coverage).toMatchObject({ work: { state: 'skipped' }, tasks: { state: 'skipped' } });
  expect(f.calls).not.toContain('work');
  expect(f.calls).not.toContain('tasks');
});

test('current Work wins before legacy tasks and all optional sources', async () => {
  const f = fixture({ work: { coverage: 'loaded', nextAction: { tool: 'work.packet', arguments: { taskId: 'assigned' } } } });
  const value = await f.service.get({ principal });
  expect(value.nextAction).toMatchObject({ tool: 'work.packet', arguments: { taskId: 'assigned' } });
  expect(f.calls).toEqual(['continuity', 'work']);
  expect(value.signals).not.toHaveProperty('assignedOpenTasks');
});

test('optional failures have fixed coverage reasons, not false empty counts or private errors', async () => {
  const f = fixture({}, ['reviewQueue', 'inbox', 'skills', 'maintenance']);
  const value = await f.service.get({ principal, skillId: 'safe-edit' });
  expect(value.nextAction).toMatchObject({ tool: 'wiki.home' });
  expect(value.coverage).toMatchObject({ reviewQueue: { state: 'unavailable', reason: 'read_failed' }, inbox: { state: 'unavailable', reason: 'read_failed' } });
  expect(value.signals).not.toHaveProperty('maintenanceAvailable');
  expect(JSON.stringify(value)).not.toContain('private backend');
  expect(JSON.stringify(value.nextAction)).not.toMatch(/No unread activity|No .*waiting/);
});

test('review wins before Inbox', async () => {
  const review = fixture({ reviewQueue: { items: [{ path: 'Knowledge/Due.md' }], total: 1 } });
  expect((await review.service.get({ principal })).nextAction).toMatchObject({ target: 'Knowledge/Due.md' });
  expect(review.calls).not.toContain('inbox');
});
