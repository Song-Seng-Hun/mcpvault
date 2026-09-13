import type { CompilationJob } from './compilation-model.js';
/** Only call after authorizing every dependency. No draft bodies or semantic
 * guarantees: these are revision-pinned agent reports for the next read. */
export declare function compilationInspection(job: CompilationJob, base: Record<string, unknown>, maxChars: number, cursor: number, publicPath: (path: string) => string): Record<string, any>;
//# sourceMappingURL=compilation-view.d.ts.map