import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { CompilationFinding } from './compilation-review.js';
interface Options {
    fs: FileSystemService;
    access: ScopeAccessPolicy;
    principal?: ScopePrincipal;
    result: Record<string, any>;
    maxChars: number;
    prettyPrint?: boolean;
    allJobs?: boolean;
    review(paths?: readonly string[]): Promise<CompilationFinding[]>;
    revalidateActor(): Promise<void>;
    retry: {
        endpointId: string;
        arguments: Record<string, unknown>;
    };
}
export declare function attachCompilationReview(options: Options): Promise<Record<string, any>>;
export {};
//# sourceMappingURL=compilation-review-view.d.ts.map