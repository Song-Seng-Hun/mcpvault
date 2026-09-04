import { describe, expect, test } from 'vitest';
import { getLlmWikiTools } from './llm-wiki-tools.js';
import { getWikiPolicyTopic, MCPVAULT_SERVER_INSTRUCTIONS, WIKI_POLICY_FINGERPRINT, WIKI_POLICY_TOPICS, WIKI_POLICY_VERSION } from './wiki-policy.js';

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
    expect(getWikiPolicyTopic(undefined, 1200)).toMatchObject({
      topic: 'overview',
      policyVersion: WIKI_POLICY_VERSION,
      policyFingerprint: WIKI_POLICY_FINGERPRINT,
      availableTopics: [...WIKI_POLICY_TOPICS],
    });
    expect(WIKI_POLICY_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    expect(() => getWikiPolicyTopic('everything', 1200)).toThrow(/Unknown policy topic/);
  });

  test('exposes bounded memory, maintenance, and ideation guidance without duplicating workflows', () => {
    expect(getWikiPolicyTopic('memory', 1600)).toMatchObject({
      routes: expect.arrayContaining(['wiki.recall_queue', 'continuity.save']),
    });
    expect(getWikiPolicyTopic('maintenance', 1600)).toMatchObject({
      routes: expect.arrayContaining(['wiki.review_packet', 'wiki.exception_board']),
    });
    expect(getWikiPolicyTopic('ideation', 1600)).toMatchObject({
      routes: expect.arrayContaining(['idea.create', 'workshop.create', 'wiki.synthesis_candidates']),
    });
    for (const topic of WIKI_POLICY_TOPICS) {
      expect(JSON.stringify(getWikiPolicyTopic(topic, 512)).length, topic).toBeLessThanOrEqual(512);
      expect(JSON.stringify(getWikiPolicyTopic(topic, 1600)).length, topic).toBeLessThanOrEqual(1600);
    }
    const policyTool = getLlmWikiTools().find(tool => tool.name === 'get_wiki_policy')!;
    expect((policyTool.inputSchema as any).properties.topic.enum).toEqual([...WIKI_POLICY_TOPICS]);
  });

});
