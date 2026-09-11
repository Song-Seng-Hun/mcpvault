import { guidanceError, guidanceText } from './guidance-runtime.js';
import { configKeys, configNumber, validateLearningPathConfiguration, validateProceduralBundleConfiguration } from './capability-graph.js';
import { LEARNING_CONFIGURATION_SCHEMA } from './learning-configuration.js';
export function checkReusableConfiguration(args) {
    configKeys(args, ['kind', 'configuration', 'maxChars']);
    const maxChars = configNumber(args.maxChars ?? 1000, 512, 12000);
    const checker = args.kind === 'learning-path' ? validateLearningPathConfiguration
        : args.kind === 'procedural-bundle' ? validateProceduralBundleConfiguration : undefined;
    if (!checker)
        throw guidanceError(Error('Supported configuration kind required'), 'guid-eb5a2b6714ad9253');
    const result = checker(args.configuration);
    while (JSON.stringify(result).length > maxChars && result.diagnostics.items.length) {
        result.diagnostics.items.pop();
        result.diagnostics.truncated = true;
    }
    if (JSON.stringify(result).length > maxChars)
        throw guidanceError(Error('Configuration summary exceeds maxChars'), 'guid-27eb1fe63b9c205f');
    return result;
}
export function getConfigurationTools() {
    const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$', maxLength: 64 };
    const ids = (maxItems) => ({ type: 'array', uniqueItems: true, maxItems, items: id });
    return [{ name: 'check_reusable_configuration',
            description: guidanceText('guid-875900fab01439cb', 'Validate a supplied learning-path or procedural-bundle configuration using the same bounded prerequisite/exclusion graph as TRPG skills. Returns a versioned fingerprint and cost summary, not competency certification, execution or permissions. No files, URLs, commands or models are read or run. This does not change an existing learning path.'),
            inputSchema: { type: 'object', additionalProperties: false, required: ['kind', 'configuration'], properties: {
                    kind: { type: 'string', enum: ['learning-path', 'procedural-bundle'] }, maxChars: { type: 'integer', minimum: 512, maximum: 12000, default: 1000 },
                    configuration: { type: 'object', additionalProperties: false, required: ['id', 'version', 'nodes', 'selected'], properties: {
                            id, version: { type: 'string', pattern: '^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$' }, selected: ids(128),
                            nodes: { type: 'array', maxItems: 128, items: { type: 'object', additionalProperties: false, required: ['id', 'requires', 'excludes', 'cost'], properties: {
                                        id, requires: ids(16), excludes: ids(16), cost: { type: 'integer', minimum: 0, maximum: 1000 },
                                    } } },
                        } },
                } } }, { name: 'preview_learning_configuration',
            description: guidanceText('guid-f847c8048ec236c5', 'Validate an explicit learning-path configuration and at most sixteen selected-node mappings against one current complete MOC route. Returns source/mapping pins and an existing continuity.save draft; human-readable learning progress is not competency certification or an execution grant. Login required; read-only and never edits a MOC.'),
            inputSchema: { type: 'object', additionalProperties: false, required: ['rootPath', 'configuration', 'mappings'], properties: {
                    rootPath: { type: 'string', minLength: 1, maxLength: 500 }, configuration: LEARNING_CONFIGURATION_SCHEMA.properties.definition,
                    mappings: LEARNING_CONFIGURATION_SCHEMA.properties.mappings,
                    order: { type: 'string', enum: ['authored', 'recommended'], default: 'authored' }, maxDepth: { type: 'integer', minimum: 0, maximum: 6, default: 2 },
                    maxChars: { type: 'integer', minimum: 1024, maximum: 12000, default: 6000 }, accessToken: { type: 'string' },
                } } }];
}
