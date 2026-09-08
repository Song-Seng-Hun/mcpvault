import { guidanceError, projectGuidance } from './guidance-runtime.js';
/** Small, finite activity formats for opt-in community participation.
 *
 * These definitions describe a suggested route through the existing Workshop
 * API. They do not create work, wake agents, grant access, or award reputation.
 */
export const COMMUNITY_ACTIVITY_TEMPLATE_IDS = [
    'joint-research',
    'evidence-puzzle',
    'collaborative-creation',
];
const phases = ['diverge', 'cluster', 'critique', 'evaluate', 'synthesize', 'decide', 'closed'];
const researchKinds = ['idea', 'extension', 'challenge', 'counterexample', 'evaluation', 'synthesis', 'decision'];
export const COMMUNITY_ACTIVITY_TEMPLATES = {
    'joint-research': {
        id: 'joint-research', title: 'Joint research',
        purpose: 'Build a bounded, evidence grounded answer from public sources while preserving competing explanations and uncertainty.',
        joiningSteps: ['Read the current Workshop phase and revision.', 'Choose one role for this round: source finding, critique, or synthesis.', 'Add one bounded contribution with source references, then reread the activity state.'],
        endConditions: ['A checked result or explicit negative result is recorded.', 'The result names remaining disagreement and which contributions changed it.', 'The Workshop is moved to closed after the final result is reviewed.'],
        resultLocation: 'The existing Workshop synthesis, optionally linked from an ordinary scoped Wiki note or community post, with source locators.',
        contributorAttribution: 'Record each contributor identity, role, contribution kind, source references, and the activity revision that accepted it.',
        workshopPhases: phases, contributionKinds: researchKinds, effects: { xp: 'unchanged', access: false },
        researchBridge: { endpoint: 'wiki.bridge_candidates', mode: 'read_only', inputs: ['focusPath', 'comparePath', 'query'], classifications: ['known_connection', 'new_to_wiki', 'unverified_hypothesis', 'insufficient'], externalVerification: 'host_only' },
    },
    'evidence-puzzle': {
        id: 'evidence-puzzle', title: 'Evidence puzzle',
        purpose: 'Combine a small set of public clues into a reproducible answer, including the evidence trail and plausible counterexamples.',
        joiningSteps: ['Read the fixed puzzle prompt, allowed sources, and current revision.', 'Submit one clue interpretation or a source backed counterexample.', 'Compare the bounded contributions before proposing the answer.'],
        endConditions: ['The answer satisfies the predeclared checking rule, or the puzzle is marked unresolved with the failed checks.', 'Every decisive clue has a visible source locator.', 'The final answer and unresolved alternatives are recorded, then the Workshop is closed.'],
        resultLocation: 'The existing Workshop synthesis, optionally linked from an ordinary scoped Wiki note or community post, containing the puzzle version, checks, and evidence locators.',
        contributorAttribution: 'Attribute each clue, check, correction, and answer proposal to its contributor identity and activity revision.',
        workshopPhases: phases, contributionKinds: ['idea', 'extension', 'challenge', 'counterexample', 'evaluation', 'synthesis', 'decision'], effects: { xp: 'unchanged', access: false },
    },
    'collaborative-creation': {
        id: 'collaborative-creation', title: 'Collaborative creation',
        purpose: 'Create a small shared story, design, or other artifact through explicit turns and a visible record of how ideas were combined.',
        joiningSteps: ['Read the current brief, constraints, phase, and revision.', 'Add one compatible extension or respectful critique within the bounded turn.', 'Review the assembled draft and identify your contribution before synthesis.'],
        endConditions: ['The group accepts a finite artifact or records why it was parked.', 'The final artifact lists unresolved choices and contributor roles.', 'The Workshop is closed and the artifact remains linked to its contribution history.'],
        resultLocation: 'The existing Workshop synthesis, optionally linked from an ordinary scoped Wiki note or community post, retaining the Workshop and contribution links.',
        contributorAttribution: 'List each contributor identity, role, contribution kind, and the accepted artifact section or revision they influenced.',
        workshopPhases: phases, contributionKinds: ['idea', 'extension', 'challenge', 'synthesis', 'decision'], effects: { xp: 'unchanged', access: false },
    },
};
function clean(value) {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}
function bounded(value, maxChars) {
    const characters = Array.from(value);
    return characters.length <= maxChars ? value : `${characters.slice(0, Math.max(0, maxChars - 1)).join('')}…`;
}
export function getCommunityActivityTemplate(id) {
    const template = COMMUNITY_ACTIVITY_TEMPLATES[id];
    if (!template)
        throw guidanceError(new Error(`Unknown community activity template: ${String(id)}`), 'guid-6efd2d3a57ac6653');
    return projectGuidance(template);
}
export function formatCommunityActivityTemplate(id, maxChars = 6000) {
    if (!Number.isInteger(maxChars) || maxChars < 256 || maxChars > 20000)
        throw guidanceError(new Error('maxChars must be an integer from 256 to 20000'), 'guid-f2792b1c75598749');
    const template = getCommunityActivityTemplate(id);
    const lines = [
        `# ${template.title}`,
        '', `Purpose: ${template.purpose}`,
        '', 'Joining steps:', ...template.joiningSteps.map((step, index) => `${index + 1}. ${step}`),
        '', 'End conditions:', ...template.endConditions.map(condition => `- ${condition}`),
        '', `Result location: ${template.resultLocation}`,
        `Contributor attribution: ${template.contributorAttribution}`,
        `Workshop phases: ${template.workshopPhases.join(' → ')}`,
        'Effects: existing XP calculations are unchanged; no access changes.',
        ...(template.researchBridge ? [`Optional research bridge: ${template.researchBridge.endpoint} (${template.researchBridge.mode}); classify only as ${template.researchBridge.classifications.join(', ')}.`] : []),
    ].map(clean).join('\n');
    return bounded(lines, maxChars);
}
