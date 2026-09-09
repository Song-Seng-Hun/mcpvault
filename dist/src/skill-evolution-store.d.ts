import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ParsedNote } from './types.js';
export type Guard = {
    path: string;
    revision: string;
};
export type SkillData = Record<string, any>;
export type SkillRecord = {
    path: string;
    revision: string;
    content: string;
    data: SkillData;
    note: ParsedNote;
};
export declare const SKILL_RECORD_BYTES: number;
export declare const SKILL_ROOT = "Community/Skills/";
export declare function canonical(value: unknown): string;
export declare const fingerprint: (value: unknown) => string;
export declare function skillId(value: unknown): string;
export declare const rootPath: (id: string) => string;
export declare const currentPath: (id: string) => string;
export declare function recordPath(id: string, kind: string, recordId: unknown): string;
export declare function text(value: unknown, field: string, max?: number): string;
export declare function revision(value: unknown): string;
export declare function expected(value: unknown): string;
export declare function budget(value: unknown): number;
export declare function bounded(result: SkillData, maxChars: unknown): SkillData;
/** Visible Markdown owns state. Only a host-held key attests service decisions.
 * The key must never be supplied by an MCP request or stored in the Vault. */
export declare class SkillEvolutionStore {
    readonly fs: FileSystemService;
    readonly access: ScopeAccessPolicy;
    private readonly key;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, key: () => string | undefined);
    private signature;
    admit(path: string, principal?: ScopePrincipal): string;
    read(path: string, principal?: ScopePrincipal): Promise<ParsedNote>;
    maybe(path: string, principal?: ScopePrincipal): Promise<ParsedNote | undefined>;
    attested(path: string, note: ParsedNote): boolean;
    record(path: string, principal?: ScopePrincipal): Promise<SkillRecord>;
    private journalRoot;
    private journal;
    private journalRecord;
    private commitPath;
    private committed;
    private journalWrite;
    private snapshot;
    /** Durable historical response; it never makes a historical revision current. */
    replay(path: string, request: SkillData, principal: ScopePrincipal, assertActor: () => Promise<void>, assertPolicy: (record: SkillRecord) => Promise<void>): Promise<SkillRecord | undefined>;
    check(guards: Guard[], principal?: ScopePrincipal): Promise<void>;
    evidence(value: unknown, container: string, principal?: ScopePrincipal, max?: number): Promise<Guard[]>;
    write(path: string, content: string, data: SkillData, expectedRevision: string, guards: Guard[], principal: ScopePrincipal, assertActor: () => Promise<void>): Promise<SkillRecord>;
}
export declare function uniqueGuards(guards: Guard[]): Guard[];
//# sourceMappingURL=skill-evolution-store.d.ts.map