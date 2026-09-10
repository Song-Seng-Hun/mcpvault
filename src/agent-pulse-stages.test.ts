import { expect, test } from 'vitest';
import { AgentPulseService } from './agent-pulse.js';

const principal = { accountId: 'pulse-worker', modelId: 'codex', role: 'model' } as const;
const emptyTasks = { tasks: [], total: 0, statusCounts: { in_progress: 0, accepted: 0, proposed: 0, blocked: 0 } };

// Boundary doubles isolate scheduling; the selected nextAction and coverage are
// outputs of the real Pulse service. Real Work/task admission has separate tests.
function fixture(values: Record<string, unknown> = {}, failures: string[] = []) {
  const calls: string[] = [];
  const read = (name: string, fallback: unknown) => async () => {
    calls.push(name);
    if (failures.includes(name)) throw Error('private backend path for ' + name);
    return name in values ? values[name] : fallback;
  };
  const service = new AgentPulseService(
    { list: read('notifications', { notifications: [], unreadCount: 0 }) } as any,
    { pulsePosts: read('posts', { activePosts: [], activeTotal: 0, ownPublishedPosts: 0, feedbackPosts: [], forumPosts: [] }) } as any,
    { listRooms: read('rooms', { rooms: [], total: 0 }) } as any,
    { listAssignedOpen: read('tasks', emptyTasks) } as any,
    { read: read('continuity', { exists: false }) } as any,
    { getForPrincipal: read('reputation', { level: 0, xp: 0, label: 'Newcomer' }) } as any,
    { reviewQueue: read('reviewQueue', { items: [], total: 0 }), inbox: read('inbox', { items: [], total: 0 }),
      readModelGeneration: () => 0, reviewPacket: read('maintenance', {}), synthesisCandidates: read('synthesis', { items: [] }) } as any,
    { listWorkshops: read('workshops', { workshops: [], total: 0 }), listIdeas: read('ideas', { ideas: [], total: 0 }) } as any,
    { pulse: read('work', { coverage: 'loaded' }) } as any,
    undefined,
    { nextAction: read('skills', undefined) } as any,
  );
  return { calls, service };
}

test('checkpoint reads only continuity, even if every lower-priority backend fails', async () => {
  const f = fixture({ continuity: { exists: true } }, ['work', 'tasks', 'notifications', 'posts', 'rooms', 'reputation', 'reviewQueue', 'inbox', 'maintenance', 'workshops', 'ideas', 'skills']);
  const value = await f.service.get({ principal, skillId: 'safe-edit' });
  expect(value.nextAction).toMatchObject({ tool: 'continuity.resume' });
  expect(f.calls).toEqual(['continuity']);
  expect(value.coverage).toMatchObject({ continuity: { state: 'loaded' }, work: { state: 'skipped' }, notifications: { state: 'skipped' } });
  expect(value.signals).not.toHaveProperty('unreadNotifications');
  expect(value.signals).not.toHaveProperty('assignedOpenTasks');
  expect(value.identity).not.toHaveProperty('xp');
});

test.each(['continuity', 'work', 'tasks'])('required %s failure does not enable lower-priority fallback', async source => {
  const f = fixture({}, [source]);
  await expect(f.service.get({ principal })).rejects.toThrow();
  expect(f.calls.at(-1)).toBe(source);
  expect(f.calls).not.toContain('notifications');
});

test('unavailable Work coverage does not masquerade as no assigned work', async () => {
  const f = fixture({ work: { coverage: 'unavailable' } });
  await expect(f.service.get({ principal })).rejects.toThrow(/work.*unavailable/i);
  expect(f.calls).toEqual(['continuity', 'work']);
});

test('current Work wins before legacy tasks and all optional sources', async () => {
  const f = fixture({ work: { coverage: 'loaded', nextAction: { tool: 'work.packet', arguments: { taskId: 'assigned' } } } });
  const value = await f.service.get({ principal });
  expect(value.nextAction).toMatchObject({ tool: 'work.packet', arguments: { taskId: 'assigned' } });
  expect(f.calls).toEqual(['continuity', 'work']);
  expect(value.signals).not.toHaveProperty('assignedOpenTasks');
});

test('notification selection skips maintenance, posts, rooms, ideas and reputation', async () => {
  const f = fixture({ notifications: { notifications: [{ sourceType: 'blog_post', sourceId: 'answer', kind: 'reply' }], unreadCount: 1 } });
  const value = await f.service.get({ principal });
  expect(value.nextAction).toMatchObject({ tool: 'community.post_read', arguments: { slug: 'answer' } });
  expect(f.calls).toEqual(['continuity', 'work', 'tasks', 'notifications']);
});

test('optional failures have fixed coverage reasons, not false empty counts or private errors', async () => {
  const f = fixture({}, ['notifications', 'reviewQueue', 'inbox', 'posts', 'skills', 'maintenance', 'workshops', 'ideas', 'rooms', 'reputation']);
  const value = await f.service.get({ principal, skillId: 'safe-edit' });
  expect(value.nextAction).toMatchObject({ tool: 'community.posts' });
  expect(value.coverage).toMatchObject({ notifications: { state: 'unavailable', reason: 'read_failed' }, rooms: { state: 'unavailable', reason: 'read_failed' } });
  expect(value.signals).not.toHaveProperty('activeRooms');
  expect(value.signals).not.toHaveProperty('maintenanceAvailable');
  expect(JSON.stringify(value)).not.toContain('private backend');
  expect(JSON.stringify(value.nextAction)).not.toMatch(/No unread activity|No .*waiting/);
});

test('review wins before Inbox, and a workshop wins before ideas and rooms', async () => {
  const review = fixture({ reviewQueue: { items: [{ path: 'Knowledge/Due.md' }], total: 1 } });
  expect((await review.service.get({ principal })).nextAction).toMatchObject({ target: 'Knowledge/Due.md' });
  expect(review.calls).not.toContain('inbox');
  expect(review.calls).not.toContain('posts');
  const workshop = fixture({ workshops: { workshops: [{ workshopId: 'open' }], total: 1 } });
  expect((await workshop.service.get({ principal })).nextAction).toMatchObject({ target: 'open' });
  expect(workshop.calls).not.toContain('ideas');
  expect(workshop.calls).not.toContain('rooms');
  expect(workshop.calls).not.toContain('reputation');
});
