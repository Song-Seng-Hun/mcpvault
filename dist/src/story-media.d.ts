/** Pure media projections over caller-selected, access-checked snapshots.
 * Paths are opaque references: this module neither resolves nor authorizes them.
 * No filesystem/network/model calls, image fetching, or Canvas writes occur.
 */
export interface StoryScreenplayBlock {
    type: 'heading' | 'action' | 'character' | 'dialogue' | 'transition';
    text: string;
}
export interface StoryMediaSource {
    id: string;
    path: string;
    revision: string;
}
export interface StoryMediaScene extends StoryMediaSource {
    title: string;
    content: string;
    /** Typed blocks are authoritative for Fountain; absent blocks use literal
     * action text from content. Manuscripts retain the original Markdown body. */
    blocks?: StoryScreenplayBlock[];
}
export interface StoryMediaImage {
    path: string;
    revision?: string;
    /** Set by the caller after authorized reference checks, never inferred here. */
    missing?: boolean;
}
export interface StoryMediaShot extends StoryMediaSource {
    sourceSceneId: string;
    sourceSceneRevision: string;
    /** Authored metadata only; shotIds is the canonical presentation sequence. */
    order: number;
    camera: string;
    action: string;
    dialogue: string;
    sound: string;
    durationSeconds: number;
    images?: StoryMediaImage[];
}
export interface StoryMediaInput {
    title: string;
    /** Array order is the explicit manuscript sequence. */
    scenes: StoryMediaScene[];
    /** Fail closed rather than truncate a manuscript or machine-readable export. */
    maxOutputChars?: number;
}
export interface StoryStoryboardInput extends StoryMediaInput {
    shots: StoryMediaShot[];
    /** Exact permutation of the supplied shot IDs, including when empty. */
    shotIds: string[];
}
export interface StoryMediaDiagnostic {
    code: 'missing_scene' | 'stale_shot' | 'missing_image';
    id: string;
    path?: string;
}
export interface StoryTextExport {
    text: string;
    sources: StoryMediaSource[];
    diagnostics: StoryMediaDiagnostic[];
}
export interface StoryCanvasFileNode {
    id: string;
    type: 'file';
    file: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface StoryCanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    toEnd: 'arrow';
}
export interface StoryCanvasExport {
    canvas: {
        nodes: StoryCanvasFileNode[];
        edges: StoryCanvasEdge[];
    };
    manifest: {
        kind: 'mcpvault-story-canvas';
        version: 1;
        sceneIds: string[];
        shotIds: string[];
        sources: StoryMediaSource[];
        shotSources: {
            shotId: string;
            sourceSceneId: string;
            sourceSceneRevision: string;
            currentSceneRevision?: string;
        }[];
        images: {
            shotId: string;
            path: string;
            revision?: string;
            missing: boolean;
        }[];
    };
    diagnostics: StoryMediaDiagnostic[];
}
export declare const STORY_MEDIA_LIMITS: Readonly<{
    scenes: 256;
    shots: 1024;
    blocksPerScene: 2048;
    imagesPerShot: 16;
    textChars: 100000;
    totalInputChars: 1000000;
    outputChars: 2000000;
}>;
/** Markdown bodies are copied exactly; wrappers and heading titles are escaped.
 * Caller must select an appropriate scope before requesting body exports. */
export declare function exportStoryManuscript(input: StoryMediaInput): StoryTextExport;
/** Derived literal-text Fountain, not a lossless Obsidian/Fountain round trip.
 * Uses . headings, ! actions, @ characters (including Korean), > transitions.
 * Literal metacharacters are escaped; ^ becomes full-width ＾ for portability.
 * Heading whitespace is trimmed at the start; unsupported prefixes are rejected.
 * Markdown code fences remain visible literal action lines, never directives.
 * See https://fountain.io/syntax/ for the target format.
 */
export declare function exportStoryFountain(input: StoryMediaInput): StoryTextExport;
/** Text storyboard includes caller-approved shot bodies and image links. */
export declare function exportStoryStoryboard(input: StoryStoryboardInput): StoryTextExport;
/** New deterministic projection only. Never accepts an existing Canvas and never
 * overwrites one. Caller owns managed/unmanaged checks, manifests, revision CAS,
 * and authorized image existence. JSON Canvas contains file nodes only, never
 * scene/shot bodies. Layout and edge order derive from explicit input sequences.
 */
export declare function buildStoryCanvas(input: StoryStoryboardInput): StoryCanvasExport;
//# sourceMappingURL=story-media.d.ts.map