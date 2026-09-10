import type { FileSystemService } from './filesystem.js';
import { type TrpgArtifact } from './roleplay-trpg-projections.js';
declare const kinds: readonly ['sheet', 'canvas', 'base'];
type Kind = typeof kinds[number];
export declare function trpgProjectionTargets(fs: FileSystemService, files: TrpgArtifact[], characterId: string, visible: (path: string) => boolean): Promise<{
    kind: Kind;
    path: string;
    revision: string;
    sourceRevision?: string;
    managed: boolean;
}[]>;
/** Bounded, revision-checked derived writes. No journal turn, deletion, or arbitrary caller path. */
export declare function projectTrpgArtifacts(options: {
    fs: FileSystemService;
    files: TrpgArtifact[];
    characterId: string;
    sourceRevision: string;
    expectedArtifacts: unknown;
    visible: (path: string) => boolean;
    assertCurrent: (checkSource: boolean) => Promise<void>;
    changed?: ((path: string) => void) | undefined;
}): Promise<{
    projected: boolean;
    sourceRevision: string;
    files: {
        kind: "base" | "canvas" | "sheet";
        path: string;
        revision: string;
    }[];
}>;
export {};
//# sourceMappingURL=roleplay-trpg-project.d.ts.map