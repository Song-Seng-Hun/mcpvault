import { describe, expect, it } from 'vitest';
import {
  RESEARCH_EXPERIMENT_SECTIONS,
  RESEARCH_LITERATURE_SECTIONS,
  RESEARCH_TEMPLATE_IDS,
  getResearchTemplate,
} from './research-templates.js';

describe('research templates', () => {
  it('exposes the three bounded research template ids', () => {
    expect(RESEARCH_TEMPLATE_IDS).toEqual(['research-journal', 'search-log', 'bridge-hypothesis']);
  });

  it('returns an ordinary journal template with the required reflection prompts', () => {
    const template = getResearchTemplate('research-journal');
    expect(template).toBeDefined();
    expect(template?.properties).toMatchObject({ note_kind: 'journal' });
    expect(template?.markdown).toContain('Question');
    expect(template?.markdown).toContain('Performed');
    expect(template?.markdown).toContain('Observations');
    expect(template?.markdown).toContain('Interpretation');
    expect(template?.markdown).toContain('Decision changes');
    expect(template?.markdown).toContain('Next action');
  });

  it('returns a search log with reproducibility and coverage prompts', () => {
    const template = getResearchTemplate('search-log');
    expect(template).toBeDefined();
    expect(template?.properties).toMatchObject({ note_kind: 'literature' });
    for (const prompt of ['Source', 'Query', 'Date', 'Inclusion', 'Exclusion', 'Read extent', 'Gaps']) {
      expect(template?.markdown).toContain(prompt);
    }
  });

  it('returns a bridge hypothesis with falsifiable mapping prompts', () => {
    const template = getResearchTemplate('bridge-hypothesis');
    expect(template).toBeDefined();
    expect(template?.properties).toMatchObject({ note_kind: 'hypothesis' });
    for (const prompt of ['Exact inputs and revisions', 'Mapping roles and relations', 'Assumptions', 'Breaks/counterexamples', "'known_connection'", "'new_to_wiki'", "'unverified_hypothesis'", "'insufficient'", 'Smallest falsifiable test', 'Next action']) {
      expect(template?.markdown).toContain(prompt);
    }
  });

  it('returns undefined for unknown ids', () => {
    expect(getResearchTemplate('unknown')).toBeUndefined();
  });

  it('provides appendable literature and experiment sections without new metadata', () => {
    expect(RESEARCH_LITERATURE_SECTIONS).toContain('Author claim');
    expect(RESEARCH_LITERATURE_SECTIONS).toContain('Interpretation');
    expect(RESEARCH_LITERATURE_SECTIONS).toContain('Exact locator');
    expect(RESEARCH_LITERATURE_SECTIONS).toContain('Read extent');
    expect(RESEARCH_EXPERIMENT_SECTIONS).toContain('Code commit or dirty patch');
    expect(RESEARCH_EXPERIMENT_SECTIONS).toContain('Data/configuration/environment/artifact provenance');
    expect(RESEARCH_EXPERIMENT_SECTIONS).toContain('Execution outcome');
    expect(RESEARCH_EXPERIMENT_SECTIONS).toContain('not proof');
  });
});
