import type { FileSystemService } from './filesystem.js';
import type { NoteWriteParams } from './types.js';
/** Canonical preview and existing guarded writer share the same validated write
 * parameters. The closure holds private copies; preview is not a bearer grant. */
export declare function preparePublicationWrite<T>(input: {
    fs: FileSystemService;
    write: NoteWriteParams;
    guards: Array<{
        path: string;
        expectedRevision: string;
    }>;
    assertAccess: () => void | Promise<void>;
    maxGuards?: number;
    projection: T;
}): {
    raw: string;
    revision: string;
    fingerprint: string;
    apply: (confirmedFingerprint: string) => Promise<T & {
        revision: string;
    }>;
};
//# sourceMappingURL=prepared-publication.d.ts.map