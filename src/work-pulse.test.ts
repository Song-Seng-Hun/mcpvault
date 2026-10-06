import { expect, test } from 'vitest';
import { AgentPulseService } from './agent-pulse.js';

// Isolate priority selection; integration tests exercise real task storage/auth.
function pulseWith(action: Record<string, unknown>) {
  return new AgentPulseService(
    { listAssignedOpen: async () => ({ tasks: [], total: 0, statusCounts: {} }) } as any,
    { read: async () => ({ exists: false }) } as any,
    undefined,
    { pulse: async () => ({ nextAction: action, reason: 'A peer needs artifact review.', summary: { pendingReviews: 1 } }) } as any,
  );
}

test('peer work review directs pulse to a bounded task packet before idle Wiki work', async () => {
  const action = { tool: 'work.packet', arguments: { taskId: 'review-target', maxChars: 3000 } };
  const result = await pulseWith(action).get({ principal: { accountId: 'reviewer', modelId: 'claude', role: 'agent', agentId: 'reviewer' } });
  expect(result.nextAction).toMatchObject(action);
  expect(String((result.nextAction as any).followUp)).toContain('requested participation');
  expect(String((result.nextAction as any).followUp)).toContain('not completed work');
  expect(JSON.stringify(result)).toContain('A peer needs artifact review.');
});
