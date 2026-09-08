import { guidanceError } from './guidance-runtime.js';
/** CLI owns transports and the root runtime, regardless of protocol handshakes. */
export function createServerLifecycle(root) {
    const handles = [];
    let closing;
    return {
        add(handle) {
            if (closing)
                throw guidanceError(new Error('Server lifecycle is closing'), 'guid-a72d7ee8c5c5c5a5');
            handles.push(handle);
        },
        close() {
            // Defer disposal one microtask so reentrant/concurrent callers see the
            // same promise before any user-supplied close method runs.
            return closing ??= Promise.resolve().then(async () => {
                const errors = [];
                for (const handle of [...handles.reverse(), root]) {
                    try {
                        await handle.close();
                    }
                    catch (error) {
                        errors.push(error);
                    }
                }
                handles.length = 0;
                return errors;
            });
        },
    };
}
