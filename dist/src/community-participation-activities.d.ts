/** Small, finite activity formats for opt-in community participation.
 *
 * These definitions describe a suggested route through the existing Workshop
 * API. They do not create work, wake agents, grant access, or award reputation.
 */
export declare const COMMUNITY_ACTIVITY_TEMPLATE_IDS: readonly ['joint-research', 'evidence-puzzle', 'collaborative-creation'];
export type CommunityActivityTemplateId = typeof COMMUNITY_ACTIVITY_TEMPLATE_IDS[number];
export type CommunityWorkshopPhase = 'diverge' | 'cluster' | 'critique' | 'evaluate' | 'synthesize' | 'decide' | 'closed';
export type CommunityContributionKind = 'idea' | 'extension' | 'challenge' | 'counterexample' | 'evaluation' | 'synthesis' | 'decision';
export type CommunityResearchClassification = 'known_connection' | 'new_to_wiki' | 'unverified_hypothesis' | 'insufficient';
export interface CommunityActivityTemplate {
    readonly id: CommunityActivityTemplateId;
    readonly title: string;
    readonly purpose: string;
    readonly joiningSteps: readonly string[];
    readonly endConditions: readonly string[];
    readonly resultLocation: string;
    readonly contributorAttribution: string;
    readonly workshopPhases: readonly CommunityWorkshopPhase[];
    readonly contributionKinds: readonly CommunityContributionKind[];
    readonly effects: {
        readonly xp: 'unchanged';
        readonly access: false;
    };
    readonly researchBridge?: {
        readonly endpoint: 'wiki.bridge_candidates';
        readonly mode: 'read_only';
        readonly inputs: readonly ['focusPath', 'comparePath', 'query'];
        readonly classifications: readonly CommunityResearchClassification[];
        readonly externalVerification: 'host_only';
    };
}
export declare const COMMUNITY_ACTIVITY_TEMPLATES: Readonly<Record<CommunityActivityTemplateId, CommunityActivityTemplate>>;
export declare function getCommunityActivityTemplate(id: CommunityActivityTemplateId): CommunityActivityTemplate;
export declare function formatCommunityActivityTemplate(id: CommunityActivityTemplateId, maxChars?: number): string;
//# sourceMappingURL=community-participation-activities.d.ts.map