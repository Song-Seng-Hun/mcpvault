import type { CodexHookHost } from './codex-hook-host.js';
import type { CodexHookContext, CodexHookOutcome } from './codex-hook-service.js';
import type { CodexPreparedCheckpointStore } from './codex-hook-adapter.js';
/** Body preparation happens before shutdown, never from a transcript. A pending
 * restriction-only record survives body failure; no existing ID is overwritten.
 * Shutdown flush verifies bytes already durable in host-private storage only. */
export declare class CodexHookCheckpointStore implements CodexPreparedCheckpointStore {
    private readonly host;
    constructor(host: CodexHookHost);
    private current;
    prepare(id: string, value: unknown, context: CodexHookContext): Promise<{
        revision: string;
    }>;
    flush(id: string, revision: string, context: CodexHookContext): Promise<CodexHookOutcome>;
    inspect(id: string, revision: string, context: CodexHookContext): Promise<CodexHookOutcome>;
    read(id: string, revision: string, context: CodexHookContext): Promise<CodexHookOutcome>;
    private inspectRecord;
}
export declare const loadCodexHookCheckpointStore: (path: string, vaultPath: string) => Promise<CodexHookCheckpointStore>;
//# sourceMappingURL=codex-hook-checkpoint.d.ts.map