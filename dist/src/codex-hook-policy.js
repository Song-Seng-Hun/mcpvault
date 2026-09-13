import { compilationPath } from './compilation-policy.js';
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop', 'SessionEnd', 'Interrupt'];
export const CODEX_HOOK_ACTIONS = ['resume', 'search', 'candidate', 'checkpoint', 'compilation', 'community'];
export const hookId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(value);
export const hookHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Routing metadata only. Never open transcript_path or use incoming mode/cwd as authority. */
export function decodeCodexHookEvent(value) {
    try {
        if (typeof value !== 'string' || Buffer.byteLength(value) > 32768)
            throw Error();
        const raw = JSON.parse(value);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !CODEX_HOOK_EVENTS.includes(raw.hook_event_name)
            || !hookId(raw.session_id) || raw.stop_hook_active !== undefined && typeof raw.stop_hook_active !== 'boolean')
            throw Error();
        return { event: raw.hook_event_name, sessionId: raw.session_id, reentrant: raw.stop_hook_active === true };
    }
    catch {
        throw Error('Hook input unavailable');
    }
}
export function validateCodexHookConfig(value) {
    const invalid = () => Error('Invalid hook configuration');
    const record = (v, keys) => {
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
            throw invalid();
        return v;
    };
    const list = (v, max, parse) => {
        if (!Array.isArray(v) || !v.length || v.length > max)
            throw invalid();
        const result = v.map(parse);
        if (new Set(result.map(item => JSON.stringify(item))).size !== result.length)
            throw invalid();
        return result;
    };
    try {
        const raw = record(value, ['version', 'enabled', 'accountId', 'projects']);
        if (raw.version !== 1 || typeof raw.enabled !== 'boolean' || !hookId(raw.accountId))
            throw invalid();
        const projects = list(raw.projects, 32, value => {
            const p = record(value, ['id', 'workspace', 'definitionHash', 'events', 'actions', 'paths']);
            if (!hookId(p.id) || !hookHash(p.definitionHash) || typeof p.workspace !== 'string' || p.workspace.length > 500
                || !/^(?:[A-Z]:\/|\/(?!\/))/.test(p.workspace) || /[\\*?"<>|\x00-\x1f\x7f]/.test(p.workspace)
                || p.workspace.replace(/^(?:[A-Z]:)?\//, '').split('/').some((s) => !s || s === '.' || s === '..' || /[. ]$/.test(s)))
                throw invalid();
            const events = list(p.events, CODEX_HOOK_EVENTS.length, v => { if (!CODEX_HOOK_EVENTS.includes(v))
                throw invalid(); return v; });
            const actions = list(p.actions, CODEX_HOOK_ACTIONS.length, v => { if (!CODEX_HOOK_ACTIONS.includes(v))
                throw invalid(); return v; });
            const paths = list(p.paths, 128, compilationPath);
            if (new Set(paths.map(p => p.toLowerCase())).size !== paths.length)
                throw invalid();
            return { id: p.id, workspace: p.workspace, definitionHash: p.definitionHash, events, actions, paths };
        });
        if (new Set(projects.map(p => p.id)).size !== projects.length)
            throw invalid();
        return { version: 1, enabled: raw.enabled, accountId: raw.accountId, projects };
    }
    catch {
        throw invalid();
    }
}
