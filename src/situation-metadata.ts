import { isModerationHidden } from './moderation-policy.js';
import { isFictionDomain } from './fiction-domain.js';

export function isSituationMemory(fm: Record<string, any>): boolean {
  return Boolean(fm.memory_entries) || ['core', 'episodic'].includes(fm.memory_role)
    || ['diary', 'log', 'reflection'].includes(fm.note_kind)
    || ['diary', 'log', 'reflection', 'journal_entry'].includes(fm.mcpvault_type);
}

export function isSituationMetadata(fm: Record<string, any>, path: string): boolean {
  return !isModerationHidden(fm) && !isFictionDomain(fm, path) && !fm.mcpvault_type && !isSituationMemory(fm);
}
