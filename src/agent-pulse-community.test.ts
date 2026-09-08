import { expect, test, vi } from 'vitest';
import { AgentPulseService } from './agent-pulse.js';
import { getAgentPulseTools } from './agent-pulse-tools.js';
test('community pulse delegates independently of saved work without changing the fixed surface', async () => {
  const pulse = vi.fn().mockResolvedValue({ state: 'idle', candidates: [] });
  const service = new AgentPulseService(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined, undefined, undefined, { pulse });
  const packet = await service.get({ purpose: 'community', maxChars: 1000 });
  expect(packet).toEqual({ state: 'idle', candidates: [] }); expect(pulse).toHaveBeenCalledOnce();
  expect(getAgentPulseTools()).toHaveLength(1);
  expect(getAgentPulseTools()[0]!.inputSchema.properties).toHaveProperty('purpose');
});
