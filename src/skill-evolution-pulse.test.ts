import { expect, test } from 'vitest';
import { AgentPulseService } from './agent-pulse.js';
import type { ScopePrincipal } from './scope-auth.js';

const principal: ScopePrincipal = { accountId: 'test', modelId: 'test', role: 'model' };
function pulse(options: { checkpoint?: boolean; busy?: boolean; ownerConsent?: boolean } = {}) {
  const calls: string[] = [];
  const service = new AgentPulseService(
    { list: async () => ({ notifications: [], unreadCount: 0 }) } as any,
    { pulsePosts: async () => ({ ownPublishedPosts: 0, activePosts: [], activeTotal: 0, feedbackPosts: [], feedbackTotal: 0, forumPosts: [], forumTotal: 0 }) } as any,
    { listRooms: async () => ({ rooms: [], total: 0 }) } as any,
    { listAssignedOpen: async () => ({ tasks: [], total: 0, statusCounts: {} }) } as any,
    { read: async () => ({ exists: options.checkpoint === true }) } as any,
    { getForPrincipal: async () => ({ level: 0, xp: 0, label: 'test' }) } as any,
    { reviewQueue: async () => ({ items: [], total: 0 }), inbox: async () => ({ items: [], total: 0 }), reviewPacket: async () => ({}) } as any,
    undefined, undefined, undefined,
    { nextAction: async ({ skillId }: { skillId: string }) => { calls.push(skillId); return { endpointId: 'skill.candidate', arguments: { skillId, candidateId: '123', op: 'read' } }; } } as any,
    undefined,
    async () => options.ownerConsent === false ? undefined : ({
      run: async <T>(reader: () => Promise<T>) => reader(), revalidate: async () => {}, assertFresh: () => {},
    }),
  );
  return { service, calls };
}
test('pulse offers one relevant skill candidate only after current work priorities', async () => {
  const f = pulse(), value = await f.service.get({ principal, skillId: 'safe-edit', maxChars: 4000 });
  expect((value as any).nextAction.tool).toBe('skill.candidate');
  expect(f.calls).toEqual(['safe-edit']); expect(JSON.stringify(value).length).toBeLessThanOrEqual(4000);
  const checkpoint = pulse({ checkpoint: true });
  const priority = await checkpoint.service.get({ principal, skillId: 'safe-edit' });
  expect((priority as any).nextAction.tool).toBe('continuity.resume'); expect(checkpoint.calls).toEqual([]);
});
test('no supplied skill or a busy host never scans skills or starts optional evolution', async () => {
  const f = pulse(); await f.service.get({ principal });
  await f.service.get({ principal, skillId: 'safe-edit', hostBusy: true });
  expect(f.calls).toEqual([]);
});

test('without owner consent a supplied skill never triggers candidate discovery', async () => {
  const f = pulse({ ownerConsent: false });
  const value = await f.service.get({ principal, skillId: 'safe-edit' });
  expect(value.nextAction.tool).toBe('wiki.home');
  expect(f.calls).toEqual([]);
});
