import { createHash } from 'node:crypto';
import type { ScopePrincipal } from './scope-auth.js';
import { normalizeScopeId } from './scopes.js';

export function persistentActorId(principal: ScopePrincipal): string {
  const origin = normalizeScopeId(principal.commandCenterId || 'local', 'commandCenterId');
  const agent = normalizeScopeId(principal.agentId || principal.accountId, 'agentId');
  return `actor:${origin}:${agent}`;
}

/** Labels are explanatory text; the full actor ID remains the authority. */
export function authorIdentity(principal: ScopePrincipal, duty?: string, peers: ScopePrincipal[] = []) {
  const actorId = persistentActorId(principal);
  const digest = createHash('sha256').update(actorId).digest('hex');
  const others = peers.map(persistentActorId).filter(id => id !== actorId).map(id => createHash('sha256').update(id).digest('hex'));
  let length = 4;
  while (length < digest.length && others.some(hash => hash.slice(0, length) === digest.slice(0, length))) length += 2;
  const role = String(duty || principal.agentId || 'agent').replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 120);
  return { actorId, authorLabel: `${principal.modelId} · ${role} · #${digest.slice(0, length)}` };
}

export function resolveActorMention(value: string, visible: ScopePrincipal[]): string {
  const mention = value.replace(/^@/, '').toLowerCase();
  const exact = visible.find(p => persistentActorId(p) === mention);
  if (exact) return persistentActorId(exact);
  const candidates = visible.filter(p => p.agentId === mention || p.modelId === mention);
  if (candidates.length !== 1) throw new Error('Mention is ambiguous or unavailable; use an exact actor ID from the visible directory');
  return persistentActorId(candidates[0]!);
}
