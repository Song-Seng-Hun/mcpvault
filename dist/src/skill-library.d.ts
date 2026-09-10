import { FileSystemService } from './filesystem.js';
/** Host import boundary only. No endpoint accepts host paths or runs imported code. */
export interface SkillSource {
    id: string;
    origin: string;
    version: string;
    license: string;
    licenseText: string;
    description: string;
    files: Array<{
        path: string;
        text: string;
    }>;
    unavailable: string[];
}
export interface SkillProjection {
    path: string;
    content: string;
    frontmatter: Record<string, unknown>;
}
export interface SkillHostEntry {
    id: string;
    origin: string;
    version: string;
    root: string;
    licensePath?: string;
}
export declare function safeText(value: string, max: number): void;
export declare function readSkillSource(entry: SkillHostEntry): Promise<SkillSource>;
export declare function projectSkill(source: SkillSource): SkillProjection[];
export declare function previewSkills(fs: FileSystemService, notes: SkillProjection[]): Promise<{
    fingerprint: string;
    rows: {
        path: string;
        action: 'create' | 'unchanged' | 'update' | 'conflict';
        expectedRevision: string;
        targetDigest: string;
    }[];
}>;
export declare function applySkills(fs: FileSystemService, notes: SkillProjection[], fingerprint: string): Promise<{
    written: number;
    unchanged: number;
    receipts: {
        path: string;
        revision: string;
    }[];
}>;
//# sourceMappingURL=skill-library.d.ts.map