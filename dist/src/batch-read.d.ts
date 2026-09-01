import type { FileSystemService } from './filesystem.js';
/**
 * Read known-safe note paths in small parallel batches. The filesystem service
 * remains responsible for path validation and revision calculation.
 */
export declare function readNotesInBatches(fileSystem: FileSystemService, paths: string[]): Promise<Map<string, any>>;
//# sourceMappingURL=batch-read.d.ts.map