import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import type { RoleplayState } from './roleplay-model.js';

// Compatibility-sensitive persisted values: do not change serialization, ID
// grammar, Unicode counting or errors when reusing this kernel across rules.
export const roleplayHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
// Requests contain receipts with revisions; avoid circular revision definitions.
export const roleplayRevision = (s: RoleplayState): string => roleplayHash({ ...s, requests: undefined });
export function roleplayId(value: unknown, label = 'id'): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value) || ['constructor', 'prototype'].includes(value)) throw guidanceError(new Error(`Invalid ${label}`), 'guid-972520f95c9d5dbd');
  return value;
}
export function roleplayAccount(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) || ['constructor', 'prototype'].includes(value)) throw guidanceError(new Error('Invalid account id'), 'guid-c0e09d4102189502');
  return value;
}
export function roleplayText(value: unknown, max = 280): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max) throw guidanceError(new Error(`Text requires 1..${max} Unicode characters`), 'guid-583f495b7b85fa56');
  return value.trim();
}
