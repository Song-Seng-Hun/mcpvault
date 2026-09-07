import { expect, test } from 'vitest';
import { isManagedCommunityPath } from './moderation-policy.js';

test('project ownership and membership stay behind managed community mutations', () => {
  expect(isManagedCommunityPath('Community/Projects/research.md')).toBe(true);
  expect(isManagedCommunityPath('COMMUNITY\\PROJECTS\\research.md')).toBe(true);
  expect(isManagedCommunityPath('Community/Projects-backup/research.md')).toBe(false);
});
