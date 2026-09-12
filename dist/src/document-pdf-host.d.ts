import type { DocumentResourceSnapshot } from './document-resource.js';
import type { DocumentStructure } from './document-structure.js';
export interface PdfHostConfig {
    version: 1;
    boundaryRoot: string;
    python: string;
    worker: string;
    sandboxHost: string;
    aclHelper: string;
    powershell: string;
    modelManifest?: string;
    ocr?: 'off' | 'rapidocr';
    layout?: boolean;
    /** Explicit operator-only opt-in; never accepted from document requests. */
    ocrMemoryMb?: 1024 | 2048;
}
export declare function assertNoPdfHostLinks(path: string): Promise<void>;
export declare function validatePdfHostConfig(input: any): PdfHostConfig;
export declare function validatePdfWorkerOutput(bytes: Buffer, exitCode: number, revision: string): any;
export declare function pdfHostEnvironment(executable: string): {
    SystemRoot: string;
    PATH: string;
    PATHEXT: string;
    POWERSHELL_TELEMETRY_OPTOUT: string;
};
export declare function pdfWorkerArguments(c: PdfHostConfig, profile: string, job: string, input: string, revision: string): string[];
/** Optional Windows-only local provider. Each job uses a new OS identity;
 * setup through teardown is serialized, with a cross-process fail-closed lock.
 * Never falls back to unrestricted Python. Host config is not an endpoint input. */
export declare class LocalPdfProvider {
    readonly config: PdfHostConfig;
    private blocked;
    private readonly cacheOwner;
    private hot;
    constructor(config: unknown);
    extract(snapshot: DocumentResourceSnapshot): Promise<DocumentStructure>;
    private convert;
}
export declare function loadPdfHostConfig(path: string): Promise<PdfHostConfig>;
export declare function configuredPdfProvider(path: string): {
    extract: (snapshot: DocumentResourceSnapshot) => Promise<DocumentStructure>;
};
//# sourceMappingURL=document-pdf-host.d.ts.map