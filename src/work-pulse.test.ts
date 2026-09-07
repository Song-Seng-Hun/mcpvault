import { expect, test } from 'vitest';
import { AgentPulseService } from './agent-pulse.js';

// Isolate priority selection; integration tests exercise real task storage/auth.
function pulseWith(action: Record<string, unknown>) {
  return new AgentPulseService(
    { list: async () => ({ notifications: [], unreadCount: 0 }) } as any,
    { pulsePosts: async () => ({ ownPublishedPosts: 0, activePosts: [], activeTotal: 0 }) } as any,
    { listRooms: async () => ({ rooms: [], total: 0 }) } as any,
    { listAssignedOpen: async () => ({ tasks: [], total: 0, statusCounts: {} }) } as any,
    { read: async () => ({ exists: false }) } as any,
    { getForPrincipal: async () => ({ level: 0, xp: 0, label: 'new' }) } as any,
    undefined, undefined,
    { pulse: async () => ({ nextAction: action, reason: 'A peer needs artifact review.', summary: { pendingReviews: 1 } }) } as any,
  );
}

test('peer work review directs pulse to a bounded task packet before social browsing', async () => {
  const action = { tool: 'work.packet', arguments: { taskId: 'review-target', maxChars: 3000 } };
  const result = await pulseWith(action).get({ principal: { accountId: 'reviewer', modelId: 'claude', role: 'agent', agentId: 'reviewer' } });
  expect(result.nextAction).toMatchObject(action);
  expect(String((result.nextAction as any).followUp)).toContain('requested participation');
  expect(String((result.nextAction as any).followUp)).toContain('not completed work');
  expect(JSON.stringify(result)).toContain('A peer needs artifact review.');
});
