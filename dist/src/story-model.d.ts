import type { ParsedNote } from './types.js';
export type StoryParams = Record<string, any>;
export type StoryNote = ParsedNote & {
    path: string;
    revision: string;
};
export interface StorySource {
    artifactId: string;
    revision: string;
}
export interface StoryGuard {
    path: string;
    expectedRevision: string;
}
/** Story references are explicit vault-relative paths, not OS aliases. */
export declare function storyPath(value: string): string;
export declare const STORY_KINDS: readonly ['bible', 'character', 'place', 'outline', 'scene', 'shot', 'summary', 'alternative', 'rehearsal', 'branch_graph', 'visual_model'];
export declare const STORY_LAYERS: readonly ['world_fact', 'belief', 'reader_reveal', 'author_plan'];
export declare const STORY_METHODS: readonly [{
    readonly id: 'snowflake';
    readonly steps: readonly ['premise', 'synopsis', 'characters', 'outline', 'scenes'];
    readonly optional: true;
}, {
    readonly id: 'discovery';
    readonly steps: readonly ['free_draft', 'reverse_outline', 'structure_review', 'revision'];
    readonly optional: true;
}, {
    readonly id: 'screenplay';
    readonly steps: readonly ['scene_purpose', 'opening_alternatives', 'blocking', 'dialogue', 'table_read'];
    readonly optional: true;
}, {
    readonly id: 'interactive';
    readonly steps: readonly ['premise', 'choices', 'conditions_effects', 'path_test', 'revision'];
    readonly optional: true;
}];
export declare function storyId(value: unknown, field?: string): string;
export declare function storyAccount(value: unknown): string;
export declare function storyText(value: unknown, field: string, max?: number, required?: boolean): string;
export declare function storyObject(value: unknown, keys: readonly string[], field: string): StoryParams;
export declare function storyList(value: unknown, field: string, max?: number): unknown[];
export declare function storyIds(value: unknown, field: string, max?: number): string[];
export declare function storyRevision(value: unknown, missing?: boolean): string;
export declare function storyHash(value: unknown): string;
export declare const storyRoot: (projectId: string) => string;
export declare const storyProjectPath: (projectId: string) => string;
export declare const storyArtifactPath: (projectId: string, artifactId: string) => string;
export declare const storyReviewPath: (projectId: string, reviewId: string) => string;
export declare function storyBrief(value: unknown): StoryParams;
export declare function storySources(value: unknown): StorySource[];
/** Small optional scene/card metadata. Long prose lives in the Markdown body. */
export declare function storyData(value: unknown): StoryParams;
//# sourceMappingURL=story-model.d.ts.map