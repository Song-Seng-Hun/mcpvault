import { describe, expect, test } from 'vitest';
import {
  COMMUNITY_ACTIVITY_TEMPLATE_IDS,
  COMMUNITY_ACTIVITY_TEMPLATES,
  formatCommunityActivityTemplate,
  getCommunityActivityTemplate,
} from './community-participation-activities.js';

describe('community participation activity templates', () => {
  test('exports exactly the finite approved activity set', () => {
    expect(COMMUNITY_ACTIVITY_TEMPLATE_IDS).toEqual(['joint-research', 'evidence-puzzle', 'collaborative-creation']);
    expect(Object.keys(COMMUNITY_ACTIVITY_TEMPLATES)).toEqual([...COMMUNITY_ACTIVITY_TEMPLATE_IDS]);
    for (const id of COMMUNITY_ACTIVITY_TEMPLATE_IDS) {
      const template = getCommunityActivityTemplate(id);
      expect(template.purpose.length).toBeGreaterThan(0);
      expect(template.joiningSteps.length).toBeGreaterThan(0);
      expect(template.endConditions.length).toBeGreaterThan(0);
      expect(template.resultLocation.length).toBeGreaterThan(0);
      expect(template.contributorAttribution.length).toBeGreaterThan(0);
      expect(template.effects).toEqual({ xp: 'unchanged', access: false });
    }
  });

  test('templates reuse the existing phase based Workshop vocabulary', () => {
    expect(COMMUNITY_ACTIVITY_TEMPLATES['joint-research'].workshopPhases).toEqual([
      'diverge', 'cluster', 'critique', 'evaluate', 'synthesize', 'decide', 'closed',
    ]);
    expect(COMMUNITY_ACTIVITY_TEMPLATES['evidence-puzzle'].contributionKinds).toContain('counterexample');
    expect(COMMUNITY_ACTIVITY_TEMPLATES['collaborative-creation'].contributionKinds).toContain('synthesis');
  });

  test('joint research exposes only an optional read-only bridge', () => {
    expect(COMMUNITY_ACTIVITY_TEMPLATES['joint-research'].researchBridge).toEqual({
      endpoint: 'wiki.bridge_candidates', mode: 'read_only', inputs: ['focusPath', 'comparePath', 'query'],
      classifications: ['known_connection', 'new_to_wiki', 'unverified_hypothesis', 'insufficient'], externalVerification: 'host_only',
    });
  });

  test('formatter is deterministic and bounded', () => {
    const rendered = formatCommunityActivityTemplate('evidence-puzzle', 300);
    expect(rendered.length).toBeLessThanOrEqual(300);
    expect(rendered).toContain('Evidence puzzle');
    expect(formatCommunityActivityTemplate('evidence-puzzle', 300)).toBe(rendered);
  });

  test('formatter rejects unknown templates and unsafe bounds', () => {
    expect(() => getCommunityActivityTemplate('unknown' as never)).toThrow(/Unknown/);
    expect(() => formatCommunityActivityTemplate('joint-research', 10)).toThrow(/maxChars/);
  });
});
