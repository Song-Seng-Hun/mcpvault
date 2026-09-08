import { FrontmatterHandler } from './frontmatter.js';
export const CONTEXT_INTENTS = ['capture', 'explore', 'decide', 'execute', 'review'];
export const normalizeContextText = (value) => value.normalize('NFKC').toLowerCase();
export function contextRulesSchema() {
    const phrases = () => ({ type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 80 } });
    return { type: 'object', additionalProperties: false, properties: {
            any: phrases(), all: phrases(), exclude: phrases(),
            intents: { type: 'array', maxItems: 8, items: { type: 'string', enum: [...CONTEXT_INTENTS] } },
        } };
}
export function validContextRules(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    return Object.entries(value).every(([key, list]) => ['any', 'all', 'exclude', 'intents'].includes(key)
        && Array.isArray(list) && list.length <= 8 && list.every(v => typeof v === 'string' && v.trim().length > 0
        && [...v].length <= 80 && (key !== 'intents' || CONTEXT_INTENTS.includes(v))));
}
export function contextRuleState(value, input, intent) {
    if (value === undefined)
        return 'unspecified';
    if (!validContextRules(value))
        return 'invalid';
    const haystack = normalizeContextText(input);
    const contains = (phrase) => haystack.includes(normalizeContextText(phrase));
    return (!value.any?.length || value.any.some(contains)) && (!value.all?.length || value.all.every(contains))
        && !value.exclude?.some(contains) && (!value.intents?.length || value.intents.includes(intent))
        ? 'conditions_matched' : 'conditions_unmatched';
}
const parser = new FrontmatterHandler();
export function assertContextRulesContent(raw) {
    // Parse YAML rather than scanning the raw key: escaped/quoted keys are legal YAML.
    const fm = parser.parse(raw).frontmatter;
    if (Object.hasOwn(fm, 'context_rules') && !validContextRules(fm.context_rules))
        throw new Error('Invalid context_rules: bounded literal any/all/exclude/intents lists required');
}
