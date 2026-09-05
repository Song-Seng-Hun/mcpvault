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

  test('teaches bounded authority shelves and distinct relation strengths progressively', () => {
    expect(WIKI_POLICY_VERSION).toBe(15);
    const retrieval = getWikiPolicyTopic('retrieval', 2000);
    const knowledge = getWikiPolicyTopic('knowledge', 2000);
    expect(retrieval.routes).toEqual(expect.arrayContaining(['wiki.authority_map']));
    expect(retrieval.rules.join(' ')).toContain('aroundAuthorityId');
    expect(knowledge.rules.join(' ')).toContain('same_as');
    expect(knowledge.rules.join(' ')).toContain('close_match');
    expect(knowledge.rules.join(' ')).toContain('related');
    expect(JSON.stringify(getWikiPolicyTopic('retrieval', 512)).length).toBeLessThanOrEqual(512);
    expect(JSON.stringify(getWikiPolicyTopic('knowledge', 512)).length).toBeLessThanOrEqual(512);
  });

  test('keeps structured completion consistent with live Markdown tasks', () => {
    const work = getWikiPolicyTopic('work', 2400);
    const guidance = (work.rules as string[]).join(' ');
    expect(guidance).toContain('task_status: completed');
    expect(guidance).toContain('open Markdown task');
    expect(guidance).toContain('automatically');
    expect(work.routes).toEqual(expect.arrayContaining(['mcp.list_tasks', 'wiki.review_packet']));
  });

  test('quality guidance is progressive and forbids fingerprint-only certification', () => {
    const maintenance = getWikiPolicyTopic('maintenance', 4000);
    expect(maintenance.routes).toContain('wiki.quality_check');
    expect(maintenance.rules.join(' ')).toContain('authoring structure');
    expect(maintenance.rules.join(' ')).toContain('fingerprint-only');
    expect(maintenance.rules.join(' ')).toContain('nextAction');
    expect(MCPVAULT_SERVER_INSTRUCTIONS).not.toContain('projection_freshness');
    const tool = getLlmWikiTools().find(tool => tool.name === 'get_wiki_quality_check')!;
    expect(tool.description).toContain('authoring structure');
    expect(tool.description).toContain('reuseOriginalArguments');
  });

  test('exception guidance explains partial counts and executable actions without eager expansion', () => {
    const maintenance = getWikiPolicyTopic('maintenance', 4000);
    expect(maintenance.rules.join(' ')).toContain('partial candidate counts');
    expect(maintenance.rules.join(' ')).toContain('matching owner revision does not certify');
    expect(maintenance.rules.join(' ')).toContain('retry.overrides');
    expect(MCPVAULT_SERVER_INSTRUCTIONS).not.toContain('validated_candidates');
    const tool = getLlmWikiTools().find(tool => tool.name === 'get_wiki_exception_board')!;
    expect(tool.description).toContain('item.nextAction');
    expect(tool.description).toContain('not the entire Vault');
  });

  test('surfaces authored synthesis as bounded idle pull work', () => {
    const knowledge = getWikiPolicyTopic('knowledge', 2400);
    const rules = (knowledge.rules as string[]).join(' ');
    expect(rules).toContain('get_agent_pulse');
    expect(rules).toContain('synthesis');
    expect(rules).toContain('vector');
    expect(knowledge.routes).toEqual(expect.arrayContaining(['wiki.synthesis_candidates']));
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

  test('routes retirement through one coherent lifecycle transition plan', () => {
    const review = getWikiPolicyTopic('review', 2000);
    const maintenance = getWikiPolicyTopic('maintenance', 2000);
    expect(review.routes).toEqual(expect.arrayContaining(['wiki.lifecycle_transition', 'notes.change_set']));
    expect(maintenance.routes).toEqual(expect.arrayContaining(['wiki.lifecycle_transition', 'notes.change_set']));
    expect(review.rules.join(' ')).toContain('archive');
    expect(review.rules.join(' ')).toContain('reactivate');
    expect(review.avoid.join(' ')).toContain('triage');
  });

  test('closes task knowledge, volatility review, cascade, and MOC rebalance loops', () => {
    const work = getWikiPolicyTopic('work', 2400);
    const review = getWikiPolicyTopic('review', 2400);
    const moc = getWikiPolicyTopic('moc', 2400);
    const workText = work.rules.join(' ');
    expect(workText).toContain('knowledge_notes');
    expect(workText).toContain('negative_knowledge_notes');
    expect(workText).toContain('retrospective');
    expect(workText).toContain('no_reusable_knowledge');
    expect(workText).toContain('exclusive');
    expect(workText).toContain('ordinary actionable');
    expect(workText).toContain('direct Obsidian');
    expect(review.rules.join(' ')).toContain('volatility_class');
    expect(review.rules.join(' ')).toContain('upstream_cascade_changed');
    expect(review.rules.join(' ')).toContain('advisory');
    expect(moc.routes).toContain('wiki.moc_rebalance');
    expect(moc.rules.join(' ')).toContain('authored heading');
    for (const policy of [work, review, moc]) expect(JSON.stringify(policy).length).toBeLessThanOrEqual(2400);
  });

});
