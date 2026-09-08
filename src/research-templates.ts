import { projectGuidance } from './guidance-runtime.js';
/** The bounded set of research notebook templates exposed by this module. */
export const RESEARCH_TEMPLATE_IDS = ['research-journal', 'search-log', 'bridge-hypothesis'] as const;

export type ResearchTemplateId = typeof RESEARCH_TEMPLATE_IDS[number];

export interface ResearchTemplate {
  readonly purpose: string;
  readonly properties: Readonly<Record<string, string>>;
  readonly markdown: string;
}

export const RESEARCH_LITERATURE_SECTIONS = `## Author claim

Record the author's claim separately from your interpretation.

## Interpretation

State your interpretation and its limits.

## Exact locator

Give the exact page, section, figure, table, timestamp, or other locator.

## Read extent

Record what portion was read and what remains unread.`;

export const RESEARCH_EXPERIMENT_SECTIONS = `## Code commit or dirty patch

Record the exact commit, branch, or dirty patch used.

## Data/configuration/environment/artifact provenance

Record the provenance and revisions of data, configuration, environment, and generated artifacts.

## Execution outcome

Record what happened during execution and what was observed; an execution outcome is evidence about that run, not proof.`;

const RESEARCH_TEMPLATES: Readonly<Record<ResearchTemplateId, ResearchTemplate>> = {
  'research-journal': {
    purpose: 'Capture a bounded research session and its decision-changing observations.',
    properties: { note_kind: 'journal' },
    markdown: `# Research journal

## Question

What question is this session addressing?

## Performed

What did you do, and which sources or tools did you use?

## Observations

What did you observe? Keep observations distinct from interpretation.

## Interpretation

What do the observations mean, and how confident are you?

## Decision changes

Which decision, belief, or plan changed because of this session?

## Next action

What is the smallest useful next action?

Use existing journal and memory metadata guidance when recording continuity; do not copy private memory into this note.`,
  },
  'search-log': {
    purpose: 'Record a reproducible search and its coverage limits.',
    properties: { note_kind: 'literature' },
    markdown: `# Search log

## Source

Which source, index, repository, or collection was searched?

## Query

What exact query, filters, and settings were used?

## Date

When was the search run?

## Inclusion

What inclusion criteria selected results?

## Exclusion

What exclusion criteria removed results?

## Read extent

Which results or portions were actually read?

## Gaps

What coverage gaps, inaccessible material, or unresolved search limits remain?`,
  },
  'bridge-hypothesis': {
    purpose: 'Make a cross-domain bridge explicit, inspectable, and falsifiable.',
    properties: { note_kind: 'hypothesis' },
    markdown: `# Bridge hypothesis

## Exact inputs and revisions

List the exact inputs, sources, versions, commits, or revisions used.

## Mapping roles and relations

Describe what maps to what, including the role of each input and the relation between them.

## New explanation or prediction

What becomes explainable or testable by selectively combining the inputs? Compare it with existing approaches; joining field names alone is insufficient.

## Assumptions

List assumptions required for the bridge.

## Breaks/counterexamples

Where does the mapping break, and what counterexamples are known or expected?

## Existing work check

Classify the current state as one or more of: 'known_connection', 'new_to_wiki', 'unverified_hypothesis', 'insufficient'.
Link the actual search log and exact sources. If web access is unavailable, record verification as waiting and its resume condition. Search absence never establishes novelty.

## Smallest falsifiable test

What is the smallest test that could show this bridge is wrong?

## Next action

What is the next action for running that test or narrowing the hypothesis?`,
  },
};

export function getResearchTemplate(id: string): ResearchTemplate | undefined {
  if (!Object.prototype.hasOwnProperty.call(RESEARCH_TEMPLATES, id)) return undefined;
  return projectGuidance(RESEARCH_TEMPLATES[id as ResearchTemplateId]);
}
