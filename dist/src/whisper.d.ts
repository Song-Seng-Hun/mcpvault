import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
export declare class WhisperService {
    private readonly fileSystem;
    private readonly references;
    constructor(fileSystem: FileSystemService, references: ReferenceService);
    send(params: {
        principal?: ScopePrincipal;
        to: string;
        content: string;
        references?: unknown;
        roomId?: string;
    }): Promise<{
        success: boolean;
        whisperId: string;
        to: string;
        path: string;
        revision: string;
    }>;
    list(params: {
        principal?: ScopePrincipal;
        limit?: number;
        maxChars?: number;
    }): Promise<{
        whispers: Record<string, unknown>[];
        total: number;
        truncated: boolean;
    }>;
}
//# sourceMappingURL=whisper.d.ts.map