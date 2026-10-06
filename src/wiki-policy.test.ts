import { describe, expect, test } from 'vitest';
import { getLlmWikiTools } from './llm-wiki-tools.js';
import { getWikiPolicyTopic, MCPVAULT_SERVER_INSTRUCTIONS, WIKI_POLICY_FINGERPRINT, WIKI_POLICY_TOPICS, WIKI_POLICY_VERSION } from './wiki-policy.js';

describe('progressive Wiki policy', () => {
  test('complete onboarding fits its budget without truncation', () => {
    const policy = getWikiPolicyTopic('onboarding', 3000);
    expect(policy.truncated).not.toBe(true);
    expect(JSON.stringify(policy).length).toBeLessThanOrEqual(3000);
  });

  test.each([512, 700, 1200])('incomplete onboarding at %i characters returns a safe continuation, not half a signup recipe', maxChars => {
    const policy = getWikiPolicyTopic('onboarding', maxChars);
    expect(JSON.stringify(policy).length).toBeLessThanOrEqual(maxChars);
    expect(policy).toMatchObject({ truncated: true, nextAction: { endpointId: 'wiki.policy', arguments: { topic: 'onboarding', maxChars: 3000 } } });
    expect(policy.routes).toBeUndefined();
    expect(policy.rules).toBeUndefined();
  });

  test('keeps the eager MCP constitution compact', () => {
    expect(Buffer.byteLength(MCPVAULT_SERVER_INSTRUCTIONS, 'utf8')).toBeLessThanOrEqual(3500);
  });

  test('returns one bounded topic instead of the whole handbook', () => {
    const policy = getWikiPolicyTopic('moc', 1200);
    expect(policy).toMatchObject({ topic: 'moc', purpose: expect.any(String), rules: expect.any(Array), routes: expect.arrayContaining(['wiki.learning_path']) });
    expect(JSON.stringify(policy).length).toBeLessThanOrEqual(1200);
    expect(JSON.stringify(policy)).not.toContain('auth.register');
  });

  test('advertises topics and rejects guesses', () => {
    expect(WIKI_POLICY_VERSION).toBe(44);
    expect(getWikiPolicyTopic(undefined, 1200)).toMatchObject({
      topic: 'overview',
      policyVersion: WIKI_POLICY_VERSION,
      policyFingerprint: WIKI_POLICY_FINGERPRINT,
      availableTopics: [...WIKI_POLICY_TOPICS],
    });
    expect(WIKI_POLICY_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    expect(() => getWikiPolicyTopic('everything', 1200)).toThrow(/Unknown policy topic/);
    const policyTool = getLlmWikiTools().find(tool => tool.name === 'get_wiki_policy')!;
    expect((policyTool.inputSchema as any).properties.topic.enum).toEqual([...WIKI_POLICY_TOPICS]);
  });

  test('every topic fits each budget', () => {
    for (const topic of WIKI_POLICY_TOPICS) {
      for (const maxChars of [512, 1600]) {
        expect(JSON.stringify(getWikiPolicyTopic(topic, maxChars)).length, topic).toBeLessThanOrEqual(maxChars);
      }
    }
    expect(JSON.stringify(getWikiPolicyTopic('knowledge', 7000)).length).toBeLessThanOrEqual(7000);
  });

  test.each([
    ['retrieval', 2000, ['wiki.authority_map']],
    ['work', 2400, ['mcp.list_tasks', 'wiki.review_packet']],
    ['knowledge', 7000, ['skill.rollback']],
    ['knowledge', 2400, ['wiki.synthesis_candidates']],
    ['memory', 1600, ['wiki.recall_queue', 'continuity.save']],
    ['maintenance', 1600, ['wiki.review_packet', 'wiki.exception_board']],
    ['maintenance', 4000, ['mcp.lint_wiki', 'wiki.quality_check']],
    ['review', 2000, ['wiki.lifecycle_transition', 'notes.change_set']],
    ['maintenance', 2000, ['wiki.lifecycle_transition', 'notes.change_set']],
    ['moc', 2400, ['wiki.moc_rebalance']],
  ] as const)('%s at %i characters routes to its endpoints', (topic, maxChars, routes) => {
    expect(getWikiPolicyTopic(topic, maxChars).routes).toEqual(expect.arrayContaining([...routes]));
  });

  test('lint accepts a bounded maxChars', () => {
    const lint = getLlmWikiTools().find(tool => tool.name === 'lint_wiki')!;
    expect((lint.inputSchema as any).properties.maxChars).toMatchObject({ minimum: 512, maximum: 16000 });
  });
});
