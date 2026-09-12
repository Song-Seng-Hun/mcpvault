import { expect, test } from 'vitest';

// Keep the initial RED an assertion about the absent sidecar, not a collection error.
const loaded = await import('./host-features.js').catch(error => {
  if (!String(error.message).includes('host-features')) throw error;
  return undefined;
});
function api(): typeof import('./host-features.js') {
  expect(loaded, 'pure host feature selection module must exist').toBeDefined();
  return loaded!;
}
const ids = [
  'wiki-core', 'document-search', 'personal-memory', 'work-management', 'collaboration',
  'ideation-research', 'explanation-translation', 'benchmarks', 'economy', 'roleplay', 'skill-evolution',
] as const;
const config = (...selected: string[]) => ({ version: 1, selected });

test('exports an explicit frozen v1 feature snapshot and core-only default', () => {
  const f = api();
  expect(f.HOST_FEATURE_IDS_V1).toEqual(ids);
  expect(Object.isFrozen(f.HOST_FEATURE_IDS_V1)).toBe(true);
  expect(f.DEFAULT_HOST_FEATURE_CONFIG).toEqual(config('wiki-core'));
  expect(Object.isFrozen(f.DEFAULT_HOST_FEATURE_CONFIG)).toBe(true);
  expect(Object.isFrozen(f.DEFAULT_HOST_FEATURE_CONFIG.selected)).toBe(true);
  expect(f.parseHostFeatureConfig(config(...ids)).selected).toHaveLength(11);
});

test.each(ids.slice(1))('%s can be selected independently with core and never silently enabled', id => {
  const f = api();
  expect(f.parseHostFeatureConfig(config('wiki-core', id)).selected).toEqual(['wiki-core', id].sort());
  expect(() => f.parseHostFeatureConfig(config(id))).toThrow(/prerequisite|core/i);
  expect(f.parseHostFeatureConfig(config('wiki-core')).selected).not.toContain(id);
});

test('work management does not imply collaboration, economy, or model execution', () => {
  const f = api();
  const selected = f.parseHostFeatureConfig(config('wiki-core', 'work-management'));
  expect(selected.selected).toEqual(['wiki-core', 'work-management']);
  expect(f.hostFeatureEligibility(selected, 'claim_work_task')).toEqual({
    feature: 'work-management', eligible: true, reason: 'selected', permissionsGranted: false,
  });
  expect(f.hostFeatureEligibility(selected, 'send_chat_message').eligible).toBe(false);
  expect(f.hostFeatureEligibility(selected, 'manage_quest_contract').eligible).toBe(false);
});

test('selection is detached and frozen; disabling and re-enabling preserves the prior configuration', () => {
  const f = api();
  const input = config('roleplay', 'wiki-core', 'personal-memory');
  const before = structuredClone(input);
  const enabled = f.parseHostFeatureConfig(input);
  const fingerprint = f.hostFeatureConfigFingerprint(enabled);
  const disabled = f.parseHostFeatureConfig(config('wiki-core'));
  expect(f.hostFeatureEligibility(disabled, 'manage_roleplay_world').eligible).toBe(false);
  const restored = f.parseHostFeatureConfig(before);
  expect(f.hostFeatureEligibility(restored, 'manage_roleplay_world').eligible).toBe(true);
  expect(f.hostFeatureConfigFingerprint(restored)).toBe(fingerprint);
  expect(input).toEqual(before);
  input.selected.push('economy');
  expect(enabled.selected).not.toContain('economy');
  expect(Object.isFrozen(enabled)).toBe(true);
  expect(Object.isFrozen(enabled.selected)).toBe(true);
});

test('fingerprints are stable across object and selection ordering but change with selection', () => {
  const f = api();
  const first = f.hostFeatureConfigFingerprint(config('wiki-core', 'work-management', 'benchmarks'));
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(f.hostFeatureConfigFingerprint({ selected: ['benchmarks', 'work-management', 'wiki-core'], version: 1 })).toBe(first);
  expect(f.hostFeatureConfigFingerprint(config('wiki-core'))).not.toBe(first);
});

const badConfigs: Array<[string, unknown]> = [
  ['missing config', undefined], ['null', null], ['encoded string', '{"version":1,"selected":["wiki-core"]}'],
  ['array root', []], ['boolean', true], ['number', 1], ['missing version', { selected: ['wiki-core'] }],
  ['missing selection', { version: 1 }], ['string version', { version: '1', selected: ['wiki-core'] }],
  ['future version', { version: 2, selected: ['wiki-core'] }], ['no core', config()],
  ['selection string', { version: 1, selected: 'wiki-core' }], ['selection null', { version: 1, selected: null }],
  ['selection object', { version: 1, selected: { 'wiki-core': true } }],
  ['unknown feature', config('wiki-core', 'future-feature')], ['duplicate', config('wiki-core', 'wiki-core')],
  ['wildcard', config('wiki-core', '*')], ['all id', config('all')], ['all preset', { version: 1, all: true }],
  ['extra all field', { ...config('wiki-core'), all: true }], ['overlong id', config('wiki-core', 'a'.repeat(65))],
  ['overlong list', config(...Array(12).fill('wiki-core'))], ['sparse list', { version: 1, selected: new Array(2) }],
  ['nested selection', { version: 1, selected: [['wiki-core']] }], ['numeric id', { version: 1, selected: [1] }],
  ['case mismatch', config('Wiki-core')], ['whitespace', config('wiki-core ')], ['path id', config('../wiki-core')],
  ['prototype id', config('constructor')], ['prototype field', JSON.parse('{"version":1,"selected":["wiki-core"],"__proto__":{"admin":true}}')],
  ['inherited fields', Object.create(config('wiki-core'))],
  ['permission grant', { ...config('wiki-core'), permissions: ['write', 'shell'] }],
  ['provider activation', { ...config('wiki-core'), provider: 'remote' }],
  ['preference grant', { ...config('wiki-core'), preferredModel: 'gemini' }],
  ['executable field', { ...config('wiki-core'), script: 'process.exit()' }],
  ['symbol field', { ...config('wiki-core'), [Symbol('hidden')]: true }],
  ['non-enumerable field', Object.defineProperty(config('wiki-core'), 'permissions', { value: ['admin'] })],
  ['extra array field', { version: 1, selected: Object.assign(['wiki-core'], { all: true }) }],
];
test.each(badConfigs)('strict parsing rejects %s', (_label, input) => {
  const f = api();
  expect(() => f.parseHostFeatureConfig(input)).toThrow();
  expect(() => f.hostFeatureConfigFingerprint(input)).toThrow();
  expect(() => f.hostFeatureEligibility(input, 'read_note')).toThrow();
});

test('rejects accessor fields without executing user code, including selection elements', () => {
  const f = api();
  let calls = 0;
  const root = Object.defineProperty({ version: 1 }, 'selected', { enumerable: true, get: () => { calls++; return ['wiki-core']; } });
  const selected = ['wiki-core'];
  Object.defineProperty(selected, '0', { enumerable: true, get: () => { calls++; return 'wiki-core'; } });
  expect(() => f.parseHostFeatureConfig(root)).toThrow();
  expect(() => f.parseHostFeatureConfig({ version: 1, selected })).toThrow();
  expect(calls).toBe(0);
});

test('accepts data-only null-prototype records without modifying them', () => {
  const f = api();
  const input = Object.assign(Object.create(null), config('wiki-core'));
  expect(f.parseHostFeatureConfig(input)).toEqual(config('wiki-core'));
  expect(Object.getPrototypeOf(input)).toBeNull();
});

const representatives = [
  ['wiki-core', 'get_wiki_canvas_view'], ['document-search', 'search_documents'],
  ['personal-memory', 'memory_recall'], ['work-management', 'read_work_board'],
  ['collaboration', 'publish_blog_post'], ['ideation-research', 'get_wiki_bridge_candidates'],
  ['explanation-translation', 'submit_explanation'], ['benchmarks', 'submit_benchmark'],
  ['economy', 'manage_quest_contract'], ['roleplay', 'manage_story_project'], ['skill-evolution', 'promote_skill'],
] as const;
test.each(representatives)('maps %s to its exact internal tool %s independently of caller permission', (feature, tool) => {
  const f = api();
  expect(f.hostFeatureForTool(tool)).toBe(feature);
  for (const selected of [config('wiki-core'), config(...ids)]) {
    const result = f.hostFeatureEligibility(selected, tool);
    expect(result.eligible).toBe(selected.selected.includes(feature));
    expect(result.permissionsGranted).toBe(false);
    expect(result.reason).toBe(result.eligible ? 'selected' : 'disabled');
    expect(JSON.stringify(result).length).toBeLessThan(200);
    expect(Object.isFrozen(result)).toBe(true);
  }
});

test.each(['get_wiki_learning_path', 'preview_learning_configuration', 'check_reusable_configuration', 'export_wiki_canvas',
  'get_wiki_canvas_health', 'save_work_state', 'resume_work_state', 'update_task', 'list_tasks', 'login_scope', 'report_content'])
('core keeps wiki navigation, learning continuity, task metadata and security: %s', tool => {
  const f = api();
  expect(f.hostFeatureEligibility(f.DEFAULT_HOST_FEATURE_CONFIG, tool).eligible).toBe(true);
});

test.each(['unknown_tool', 'search_documents_future', 'wiki.future', 'documents.search', 'mcp.read_note',
  'constructor', '__proto__', '*', '', 'read_note ', 'READ_NOTE', 'a'.repeat(256)])
('fails closed for unregistered or unresolved identity %s even with every feature selected', tool => {
  const f = api();
  expect(f.hostFeatureForTool(tool)).toBeUndefined();
  expect(f.hostFeatureEligibility(config(...ids), tool)).toEqual({ eligible: false, reason: 'unmapped', permissionsGranted: false });
});

test('exports a frozen mapping whose names have exactly one known feature; no feature enables another', () => {
  const f = api();
  expect(Object.isFrozen(f.HOST_FEATURE_TOOL_MAP)).toBe(true);
  for (const [tool, feature] of Object.entries(f.HOST_FEATURE_TOOL_MAP)) {
    expect(ids).toContain(feature);
    expect(tool).toMatch(/^[a-z][a-z0-9_]*$/);
    for (const selected of ids) {
      expect(f.hostFeatureEligibility(config(...new Set(['wiki-core', selected])), tool).eligible)
        .toBe(feature === 'wiki-core' || feature === selected);
    }
  }
});
