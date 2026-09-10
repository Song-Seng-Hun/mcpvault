import { type RoleplayState } from './roleplay-model.js';
export interface TrpgArtifact {
    path: string;
    content: string;
}
/** An integrity marker detects manual edits; it is not authentication or permission. */
export declare function trpgArtifactSource(file: TrpgArtifact, characterId: string): string | undefined;
export declare function trpgContextRows(s: RoleplayState, characterId: string, readableRooms: ReadonlySet<string>): Array<Record<string, any>>;
export declare function trpgRows(s: RoleplayState, characterId?: string): Array<Record<string, any>>;
/** Pure managed artifacts, never authority. Persistence goes through project guards. */
export declare function trpgArtifacts(s: RoleplayState, characterId: string): TrpgArtifact[];
//# sourceMappingURL=roleplay-trpg-projections.d.ts.map