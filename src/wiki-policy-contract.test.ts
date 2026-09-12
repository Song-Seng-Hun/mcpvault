import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createServer, getServerRuntime, type ServerRuntime } from '../tests/server-fixture.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';
import { getWikiPolicyTopic, WIKI_POLICY_FINGERPRINT, WIKI_POLICY_TOPICS, WIKI_POLICY_VERSION } from './wiki-policy.js';

const CONTROL_TOOLS = new Set(['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint']);
const POLICY_BUDGETS = [512, 7000, 16000] as const;

let server: ReturnType<typeof createServer> | undefined;
let runtime: ServerRuntime | undefined;
let vaultPath: string | undefined;

beforeEach(async () => {
  vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-policy-contract-'));
  server = createServer(vaultPath, { version: '1.0.0' });
  runtime = getServerRuntime(server);
  if (!runtime) {
    throw new Error('Server runtime unavailable after createServer');
  }
  runtime.ensureEndpointRegistry();
});

afterEach(async () => {
  if (server) await server.close();
  if (vaultPath) await rm(vaultPath, { recursive: true, force: true });
  server = undefined;
  runtime = undefined;
  vaultPath = undefined;
});

function getRoutes(policy: Record<string, unknown>): string[] {
  return Array.isArray(policy.routes) ? policy.routes as string[] : [];
}

describe('get_wiki_policy contract', () => {
  test('creative work guidance is opt-in and routes only through the nine story endpoints', () => {
    expect([...WIKI_POLICY_TOPICS]).toContain('story');
    const policy = getWikiPolicyTopic('story', 12000);
    expect(getRoutes(policy)).toEqual(['story.project', 'story.artifact', 'story.sequence', 'story.context', 'story.review', 'story.adopt', 'story.session', 'story.export', 'story.visual']);
    expect(JSON.stringify(policy)).toMatch(/host/i);
    expect(JSON.stringify(policy)).toMatch(/revision/i);
    expect(JSON.stringify(policy)).toMatch(/visual_model/);
    expect(JSON.stringify(policy)).toMatch(/Unicode/);
  });
  test('all public topics are bounded at minimum, mid, and maximum budgets', () => {
    for (const topic of WIKI_POLICY_TOPICS) {
      const responses = POLICY_BUDGETS.map(maxChars => getWikiPolicyTopic(topic, maxChars));
      const fingerprints = new Set(responses.map(policy => policy.policyFingerprint as string));
      expect(fingerprints.size).toBe(1);
      const canonicalFingerprint = responses[2].policyFingerprint as string;
      expect(canonicalFingerprint).toBe(WIKI_POLICY_FINGERPRINT);
      for (const [index, maxChars] of POLICY_BUDGETS.entries()) {
        const policy = responses[index];
        expect(policy).toMatchObject({
          topic,
          policyVersion: WIKI_POLICY_VERSION,
          policyFingerprint: canonicalFingerprint,
        });
        expect(JSON.stringify(policy).length).toBeLessThanOrEqual(maxChars);
      }
    }
  });

  test('a truncated read can be re-fetched without policy corruption', () => {
    const truncatedTopics = WIKI_POLICY_TOPICS.filter(topic => Boolean((getWikiPolicyTopic(topic, 512) as { truncated?: boolean }).truncated));
    expect(truncatedTopics.length).toBeGreaterThan(0);
    for (const topic of truncatedTopics) {
      const initial = getWikiPolicyTopic(topic, 512) as {
        truncated?: boolean;
        policyVersion: number;
        policyFingerprint: string;
        rules?: unknown;
        avoid?: unknown;
        routes?: unknown;
      };
      const reloaded = getWikiPolicyTopic(topic, 16000) as {
        rules?: unknown[];
        avoid?: unknown[];
        routes?: unknown[];
      };
      expect(reloaded).toMatchObject({
        topic,
        policyFingerprint: initial.policyFingerprint,
        policyVersion: initial.policyVersion,
      });
      expect(reloaded.policyFingerprint).toBe(WIKI_POLICY_FINGERPRINT);
      expect(reloaded.policyVersion).toBe(WIKI_POLICY_VERSION);
      expect(reloaded.policyVersion).toBe(initial.policyVersion);

      if (Array.isArray(initial.rules)) initial.rules.push('__policy-contract-check__');
      if (Array.isArray(initial.avoid)) initial.avoid.push('__policy-contract-check__');
      if (Array.isArray(initial.routes)) initial.routes.push('__policy-contract-check__');

      const rechecked = getWikiPolicyTopic(topic, 16000) as { rules?: unknown[]; avoid?: unknown[]; routes?: unknown[]; policyFingerprint: string };
      expect(rechecked.policyFingerprint).toBe(initial.policyFingerprint);
      expect(Boolean(rechecked.rules?.includes('__policy-contract-check__'))).toBe(false);
      expect(Boolean(rechecked.avoid?.includes('__policy-contract-check__'))).toBe(false);
      expect(Boolean(rechecked.routes?.includes('__policy-contract-check__'))).toBe(false);
    }
  });

  test('caller-side mutation of returned arrays cannot contaminate later policy reads', () => {
    const control = WIKI_POLICY_TOPICS.map(topic => ({
      topic,
      baseline: getWikiPolicyTopic(topic, 16000) as { policyFingerprint: string; rules?: unknown[]; avoid?: unknown[]; routes?: unknown[] },
      mutated: getWikiPolicyTopic(topic, 12000) as { rules?: unknown[]; avoid?: unknown[]; routes?: unknown[] },
    }));

    for (const item of control) {
      if (Array.isArray(item.mutated.rules)) item.mutated.rules.push('__mutated-caller-array__');
      if (Array.isArray(item.mutated.avoid)) item.mutated.avoid.push('__mutated-caller-array__');
      if (Array.isArray(item.mutated.routes)) item.mutated.routes.push('__mutated-caller-array__');
      const reread = getWikiPolicyTopic(item.topic, 16000) as {
        rules?: unknown[];
        avoid?: unknown[];
        routes?: unknown[];
        policyFingerprint: string;
      };
      expect(reread.policyFingerprint).toBe(item.baseline.policyFingerprint);
      expect(Boolean(reread.rules?.includes('__mutated-caller-array__'))).toBe(false);
      expect(Boolean(reread.avoid?.includes('__mutated-caller-array__'))).toBe(false);
      expect(Boolean(reread.routes?.includes('__mutated-caller-array__'))).toBe(false);
    }
  });

  test('public topic list matches get_wiki_policy tool schema', () => {
    const policyTool = getLlmWikiTools().find(tool => tool.name === 'get_wiki_policy');
    expect(policyTool).toBeDefined();
    const schemaTopics = [...new Set((policyTool!.inputSchema as { properties?: { topic?: { enum?: string[] } } }).properties?.topic?.enum || [])];
    expect(schemaTopics.sort()).toEqual([...WIKI_POLICY_TOPICS].sort());
  });

  test('all returned routes resolve in the endpoint registry for each budget tier', () => {
    const missing = WIKI_POLICY_TOPICS.flatMap(topic => POLICY_BUDGETS.flatMap(maxChars => {
      const policy = getWikiPolicyTopic(topic, maxChars);
      return getRoutes(policy).map(route => ({ topic, maxChars, route })).filter(({ route }) => {
        if (CONTROL_TOOLS.has(route)) return false;
        return runtime?.endpointRegistry.resolve(route) === undefined;
      });
    }));
    expect(missing).toEqual([]);
  });
});
