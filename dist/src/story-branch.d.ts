/** Pure declarative story graphs. No scripts, IO, randomness, or live-world state.
 * IDs are exact and case-sensitive. Choice IDs are unique across the graph.
 * Conditions are ANDed; effects run in authored order. Graph topology diagnostics
 * ignore conditions (they are not claims about satisfiability).
 */
export type StoryBranchValue = boolean | number | string;
export interface StoryBranchVariable {
    id: string;
    type: 'boolean' | 'number' | 'string';
    initialValue: StoryBranchValue;
}
export interface StoryBranchCondition {
    variableId: string;
    operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
    value: StoryBranchValue;
}
export interface StoryBranchEffect {
    variableId: string;
    operation: 'set' | 'add';
    value: StoryBranchValue;
}
export interface StoryBranchChoice {
    id: string;
    label: string;
    targetId: string;
    conditions?: StoryBranchCondition[];
    effects?: StoryBranchEffect[];
}
export interface StoryBranchNode {
    id: string;
    end?: boolean;
    choices: StoryBranchChoice[];
}
export interface StoryBranchGraph {
    revision: string;
    startNodeId: string;
    variables: StoryBranchVariable[];
    nodes: StoryBranchNode[];
}
export interface StoryBranchDiagnostic {
    code: 'invalid_structure' | 'bound_exceeded' | 'duplicate_variable' | 'duplicate_node' | 'duplicate_choice' | 'unknown_variable' | 'type_mismatch' | 'broken_start' | 'broken_target' | 'end_choices' | 'unreachable' | 'dead_end' | 'cycle';
    severity: 'error' | 'warning';
    message: string;
    nodeId?: string;
    choiceId?: string;
    variableId?: string;
    nodeIds?: string[];
}
export interface StoryBranchValidation {
    valid: boolean;
    diagnostics: StoryBranchDiagnostic[];
    diagnosticsTruncated: boolean;
}
export interface StoryBranchRunInput {
    graph: StoryBranchGraph;
    expectedRevision: string;
    /** Partial overrides of declared defaults; undeclared keys are rejected. */
    initialState: Record<string, StoryBranchValue>;
    choiceIds: string[];
    /** 1..256, default 64. Unconsumed choices are not evaluated. */
    maxSteps?: number;
}
export interface StoryBranchTraceStep {
    step: number;
    choiceId: string;
    fromNodeId: string;
    toNodeId: string;
    state: Record<string, StoryBranchValue>;
}
export interface StoryBranchRunResult {
    graphRevision: string;
    currentNodeId: string;
    state: Record<string, StoryBranchValue>;
    trace: StoryBranchTraceStep[];
    /** Descriptors only: effects and conditions are retained in the fixed graph. */
    availableChoices: {
        id: string;
        label: string;
        targetId: string;
    }[];
    consumedChoices: number;
    stepLimitReached: boolean;
    ended: boolean;
    deadEnd: boolean;
}
export declare const STORY_BRANCH_LIMITS: Readonly<{
    nodes: 256;
    variables: 128;
    choices: 2048;
    choicesPerNode: 64;
    rulesPerChoice: 32;
    rules: 8192;
    stringChars: 4096;
    choiceSequence: 4096;
    steps: 256;
    diagnostics: 256;
    outputChars: 2000000;
}>;
/** Validate untrusted JSON-shaped input without running it. Malformed or overlarge
 * graphs return error diagnostics; cycles, unreachable nodes and dead ends are
 * warnings. Results contain at most 256 diagnostics.
 */
export declare function validateStoryBranchGraph(graph: StoryBranchGraph): StoryBranchValidation;
/** Replay from start on the supplied exact graph revision. Throws on invalid
 * graph/state/consumed choice. Caller supplies a trustworthy graph revision;
 * this pure function compares it but does not mint, hash or persist revisions.
 * A step cap returns a partial trace and consumedChoices for explicit resumption
 * by replay. Input objects are never modified; returned snapshots are detached.
 */
export declare function runStoryBranch(input: StoryBranchRunInput): StoryBranchRunResult;
//# sourceMappingURL=story-branch.d.ts.map