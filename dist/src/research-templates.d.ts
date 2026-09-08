/** The bounded set of research notebook templates exposed by this module. */
export declare const RESEARCH_TEMPLATE_IDS: readonly ['research-journal', 'search-log', 'bridge-hypothesis'];
export type ResearchTemplateId = typeof RESEARCH_TEMPLATE_IDS[number];
export interface ResearchTemplate {
    readonly purpose: string;
    readonly properties: Readonly<Record<string, string>>;
    readonly markdown: string;
}
export declare const RESEARCH_LITERATURE_SECTIONS = "## Author claim\n\nRecord the author's claim separately from your interpretation.\n\n## Interpretation\n\nState your interpretation and its limits.\n\n## Exact locator\n\nGive the exact page, section, figure, table, timestamp, or other locator.\n\n## Read extent\n\nRecord what portion was read and what remains unread.";
export declare const RESEARCH_EXPERIMENT_SECTIONS = "## Code commit or dirty patch\n\nRecord the exact commit, branch, or dirty patch used.\n\n## Data/configuration/environment/artifact provenance\n\nRecord the provenance and revisions of data, configuration, environment, and generated artifacts.\n\n## Execution outcome\n\nRecord what happened during execution and what was observed; an execution outcome is evidence about that run, not proof.";
export declare function getResearchTemplate(id: string): ResearchTemplate | undefined;
//# sourceMappingURL=research-templates.d.ts.map