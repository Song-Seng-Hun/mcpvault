import type { MemoryRole } from '../memory-contract.js';

export const MEMORY_INTENTS = ['self_contained', 'resume', 'procedure', 'past_decision', 'incident', 'environment'] as const;
export type MemoryIntent = typeof MEMORY_INTENTS[number];
export interface MemoryTaskContext { intent: MemoryIntent }
export interface MemoryPlan {
  intent: MemoryIntent; strategy: 'none' | 'continuity' | 'selective';
  mandatoryRules: 'unchanged'; preferredRoles: MemoryRole[];
}

/** Optional relevance only. The caller must still enforce scope, filters and corrections. */
export function planMemory(mode: string, context: unknown, explicitRead: boolean): MemoryPlan | undefined {
  if (context === undefined) return;
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || Object.keys(context).some(key => key !== 'intent')
    || !MEMORY_INTENTS.includes((context as MemoryTaskContext).intent)) throw Error('Invalid memory task context');
  const { intent } = context as MemoryTaskContext;
  const strategy = mode === 'brief' && !explicitRead
    ? intent === 'self_contained' ? 'none' : intent === 'resume' ? 'continuity' : 'selective'
    : 'selective';
  const preferredRoles: MemoryRole[] = intent === 'procedure' ? ['core', 'procedural', 'semantic', 'episodic', 'resource']
    : intent === 'incident' ? ['core', 'episodic', 'semantic', 'procedural', 'resource']
    : intent === 'past_decision' || intent === 'environment' ? ['core', 'semantic', 'episodic', 'procedural', 'resource']
    : ['core', 'episodic', 'semantic', 'procedural', 'resource'];
  return { intent, strategy, mandatoryRules: 'unchanged', preferredRoles };
}
