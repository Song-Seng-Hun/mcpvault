import { CodexHookService } from './codex-hook-service.js';
import { CodexHookServiceAdapter } from './codex-hook-adapter.js';
export function connectCodexHooks(options, services, readOnly) {
    if (readOnly || !options?.host || !options.attest || !options.bind)
        return () => { };
    const service = new CodexHookService({ host: options.host, attest: options.attest,
        adapter: new CodexHookServiceAdapter({ ...services, ...(options.checkpoint && { checkpoint: options.checkpoint }),
            ...(options.session && { compilationSession: options.session }) }) });
    let unbind;
    try {
        unbind = options.bind((payload, signal) => service.run(payload, signal));
    }
    catch (error) {
        service.close();
        throw error;
    }
    let closed = false;
    return () => { if (closed)
        return; closed = true; service.close(); unbind(); };
}
