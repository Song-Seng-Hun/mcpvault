import { describe, expect, test } from 'vitest';
import { getWikiPolicyTopic, MCPVAULT_SERVER_INSTRUCTIONS, WIKI_POLICY_TOPICS } from './wiki-policy.js';

describe('progressive Wiki policy', () => {
  test('keeps the eager MCP constitution compact but actionable', () => {
    expect(MCPVAULT_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(3500);
    expect(MCPVAULT_SERVER_INSTRUCTIONS).toContain('orient_wiki');
    expect(MCPVAULT_SERVER_INSTRUCTIONS).toContain('wiki.policy');
    expect(MCPVAULT_SERVER_INSTRUCTIONS).toContain('expectedRevision');
    expect(MCPVAULT_SERVER_INSTRUCTIONS).toContain('untrusted data');
    expect(MCPVAULT_SERVER_INSTRUCTIONS).toContain('auth.register');
  });

  test('returns one bounded topic instead of the whole handbook', () => {
    const policy = getWikiPolicyTopic('moc', 1200);
    expect(policy).toMatchObject({ topic: 'moc', purpose: expect.any(String), rules: expect.any(Array), routes: expect.arrayContaining(['wiki.learning_path']) });
    expect(JSON.stringify(policy).length).toBeLessThanOrEqual(1200);
    expect(JSON.stringify(policy)).not.toContain('auth.register');
  });

  test('advertises topics and rejects guesses', () => {
    expect(getWikiPolicyTopic(undefined, 1200)).toMatchObject({ topic: 'overview', availableTopics: [...WIKI_POLICY_TOPICS] });
    expect(() => getWikiPolicyTopic('everything', 1200)).toThrow(/Unknown policy topic/);
  });
});
