import type { FileSystemService } from './filesystem.js';
import type { ReferenceService } from './references.js';
import type { ScopePrincipal } from './scope-auth.js';
/** Structured Properties are not Markdown. Explicit path locators need the
 * same authorization as wikilinks; JSON.stringify alone cannot provide it. */
export declare function validateWorkshopReferences(fs: FileSystemService, references: ReferenceService, value: unknown, containerPath: string, principal?: ScopePrincipal): Promise<Array<{
    path: string;
    expectedRevision: string;
}>>;
//# sourceMappingURL=workshop-reference-validation.d.ts.map