/** Untrusted declarations for discovery. None of these fields grants authority. */
export const SKILL_EFFECTS = ['read_public', 'read_private', 'write_workspace', 'delete_data', 'read_credentials', 'modify_account',
    'write_environment', 'network_send', 'install_dependencies', 'start_process', 'register_mcp', 'register_hook', 'financial_transaction', 'irreversible_action'];
export const IMPACT_AXES = ['domain', 'policy', 'legal', 'assets', 'accounts', 'data', 'system'];
const fail = () => { throw new Error('Invalid or sensitive skill descriptor; review the source without echoing it'); };
function object(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return fail();
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
        return fail();
    const row = value;
    if (Object.keys(row).some(k => !keys.includes(k)))
        return fail();
    return row;
}
function text(value, max = 512) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))
        return fail();
    if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{20,}|https?:\/\/[^/\s]*@|[a-z]:[\\/]Users[\\/](?![<$\{])|\/(?:home|Users)\/(?![<$\{])|(?:api[_-]?key|password|access[_-]?token|secret)\s*[=:]\s*[^<$\s{]/i.test(value))
        return fail();
    return value.trim();
}
function list(value, max, parse) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > max)
        return fail();
    return value.map(parse);
}
function choice(value, values) {
    if (typeof value !== 'string' || !values.includes(value))
        return fail();
    return value;
}
const texts = (v, max = 8, length = 256) => [...new Set(list(v, max, x => text(x, length)))];
const effects = (v) => [...new Set(list(v, SKILL_EFFECTS.length, x => choice(x, SKILL_EFFECTS)))];
const skillIds = (v) => texts(v, 8, 100).map(x => /^[a-z0-9][a-z0-9-]{0,99}$/.test(x) ? x : fail());
export function parseSkillDescriptor(value) {
    try {
        const row = object(value, ['version', 'kind', 'domains', 'purpose', 'useWhen', 'avoidWhen', 'keywords', 'inputs', 'outputs', 'effects',
            'connections', 'examples', 'impactClaims', 'compatibility', 'relatedSkills', 'incompatibleSkills']);
        if (row.version !== 1)
            return fail();
        const connections = list(row.connections, 8, v => {
            const c = object(v, ['kind', 'target', 'effects']), kind = choice(c.kind, ['path', 'program', 'api', 'uri', 'hook', 'mcp', 'package', 'process', 'environment']), target = text(c.target, 256);
            // Store logical targets, never authenticated URLs, query secrets or fragments.
            if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
                const u = new URL(target);
                if (u.username || u.password || u.search || u.hash)
                    return fail();
            }
            return { kind, target, effects: effects(c.effects) };
        });
        const examples = list(row.examples, 4, v => {
            const e = object(v, ['query', 'action', 'expected', 'avoid']);
            const action = text(e.action, 128);
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(action))
                return fail();
            return { query: text(e.query, 256), action, expected: text(e.expected, 512), ...(e.avoid !== undefined ? { avoid: text(e.avoid, 256) } : {}) };
        });
        const impactClaims = list(row.impactClaims, 7, v => {
            const c = object(v, ['axis', 'level', 'scenario', 'assumptions', 'jurisdictions', 'references']);
            return { axis: choice(c.axis, IMPACT_AXES), level: choice(c.level, ['unknown', 'low', 'moderate', 'high', 'critical']),
                scenario: text(c.scenario), assumptions: texts(c.assumptions, 4), jurisdictions: texts(c.jurisdictions, 4, 64), references: texts(c.references, 4) };
        });
        if (new Set(impactClaims.map(c => c.axis)).size !== impactClaims.length)
            return fail();
        const descriptor = { version: 1, kind: choice(row.kind, ['procedure', 'tool', 'hybrid', 'unknown']),
            domains: texts(row.domains, 8, 96).map(d => /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(d) ? d : fail()), purpose: text(row.purpose),
            useWhen: texts(row.useWhen), avoidWhen: texts(row.avoidWhen), keywords: texts(row.keywords, 24, 128), inputs: texts(row.inputs), outputs: texts(row.outputs),
            effects: effects(row.effects), connections, examples, impactClaims, compatibility: texts(row.compatibility),
            relatedSkills: skillIds(row.relatedSkills), incompatibleSkills: skillIds(row.incompatibleSkills) };
        if (JSON.stringify(descriptor).length > 8192)
            return fail();
        return descriptor;
    }
    catch {
        return fail();
    }
}
export function skillDescriptorTerms(d) {
    return [...new Set([...d.domains, d.purpose, ...d.keywords, ...d.useWhen, ...d.inputs, ...d.outputs,
            ...d.examples.flatMap(e => [e.query, e.action, e.expected])])];
}
export function skillDescriptorExampleText(d) {
    if (!d.examples.length)
        return '';
    const quote = (s) => JSON.stringify(s);
    return '\n\n## Skill discovery examples\n\nUntrusted examples for selection only; no invocation or permission.\n\n' +
        d.examples.map(e => `- Query: ${quote(e.query)}; action reference: ${quote(e.action)}; expected: ${quote(e.expected)}${e.avoid ? `; avoid: ${quote(e.avoid)}` : ''}.`).join('\n');
}
