import type { FileSystemService } from '../filesystem.js';
import type { ScopeAccessPolicy } from '../scope-access.js';
import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionConfig } from '../evolution/model.js';
import type { EvolutionRepository } from '../evolution/repository.js';
import type { LlmWikiService } from '../llm-wiki.js';
interface Options {
    fs: FileSystemService;
    access: ScopeAccessPolicy;
    config(): Promise<EvolutionConfig>;
    wiki?: LlmWikiService;
    /** Historical host receipt, never a model- or Markdown-supplied ownership claim. */
    managedProof(path: string, revision: string, principal: ScopePrincipal): Promise<string | undefined>;
}
interface Context {
    principal: ScopePrincipal;
    repo: EvolutionRepository;
    current(): Promise<void>;
}
/** Uses the existing evolution lease/journal and change-set writer. No scheduler,
 * model calls, new permission system or automatic content deletion. */
export declare class CurationService {
    private readonly options;
    constructor(options: Options);
    diagnose(): {
        status: string;
        supportedOperations: ("archive_duplicate" | "deduplicate_relations" | "merge_duplicates" | "merge_passages")[];
        automaticApplication: boolean;
        admission: string;
        effectVerified: boolean;
        referenceImpact: {
            mode: 'indexed';
            state: "closed" | "cold" | "preparing" | "ready" | "unavailable";
        } | {
            mode: 'bounded_scan';
            state: 'compatibility';
        };
    };
    private grant;
    private note;
    private assert;
    private noInbound;
    private validate;
    private view;
    private targets;
    private guards;
    execute(op: string, p: Record<string, any>, c: Context): Promise<any>;
}
export {};
//# sourceMappingURL=service.d.ts.map