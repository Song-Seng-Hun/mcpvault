import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { validateCapabilitySelection, type CapabilityNode } from './capability-graph.js';

/** Explicit v1 snapshot. Adding a future feature must not expand saved selections. */
export const HOST_FEATURE_IDS_V1 = Object.freeze([
  'wiki-core', 'document-search', 'personal-memory', 'work-management',
  'skill-evolution',
] as const);
export type HostFeatureId = typeof HOST_FEATURE_IDS_V1[number];
/** Removed from v1. Saved selections may still name them; they are dropped, so
 * an older configuration keeps loading with the features that remain. */
export const REMOVED_HOST_FEATURE_IDS: readonly string[] = Object.freeze([
  'benchmarks', 'collaboration', 'economy', 'explanation-translation', 'ideation-research', 'roleplay',
]);
/** The one warning a host prints when a selection names removed features. */
export function warnRemovedHostFeatures(ids: readonly string[]): void {
  console.error(`MCPVault features: ignoring removed features: ${ids.join(', ')}`);
}
export interface HostFeatureConfig {
  readonly version: 1;
  readonly selected: readonly HostFeatureId[];
}
export const DEFAULT_HOST_FEATURE_CONFIG: HostFeatureConfig = Object.freeze({
  version: 1, selected: Object.freeze(['wiki-core'] as const),
});

// Features depend only on core. Cross-feature operations require their own
// integration checks; they must never silently enable a whole unrelated feature.
const graph: CapabilityNode[] = HOST_FEATURE_IDS_V1.map(id => ({
  id, requires: id === 'wiki-core' ? [] : ['wiki-core'], excludes: [], cost: 0,
}));

/** Strict data-only object parsing. No coercion, getters, execution or defaults.
 * The host owns bounded JSON/file loading and chooses the default explicitly. */
export function parseHostFeatureConfig(input: unknown, onRemoved?: (ids: readonly string[]) => void): HostFeatureConfig {
  if (!input || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw guidanceError(new Error('Host feature configuration must be a plain data object'), 'guid-8cc3e0bbc4d56326');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || !keys.includes('version') || !keys.includes('selected')) {
    throw guidanceError(new Error('Host feature configuration requires exactly version and selected fields'), 'guid-c8d6bdd82febaacb');
  }
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Object.values(fields).some(field => !Object.hasOwn(field, 'value') || !field.enumerable)) {
    throw guidanceError(new Error('Host feature configuration fields must be enumerable data'), 'guid-e81fcbaa21d1ac35');
  }
  if (fields.version!.value !== 1) throw guidanceError(new Error('Unsupported host feature configuration version'), 'guid-69e0395c276e6794');
  const list: unknown = fields.selected!.value;
  if (!Array.isArray(list) || types.isProxy(list) || Object.getPrototypeOf(list) !== Array.prototype
    || list.length < 1 || list.length > HOST_FEATURE_IDS_V1.length + REMOVED_HOST_FEATURE_IDS.length
    || Reflect.ownKeys(list).length !== list.length + 1) {
    throw guidanceError(new Error('Host feature selected list outside bounds'), 'guid-c15bfe68dd910864');
  }
  const selected: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const element = Object.getOwnPropertyDescriptor(list, String(i));
    if (!element || !Object.hasOwn(element, 'value') || !element.enumerable || typeof element.value !== 'string') {
      throw guidanceError(new Error('Host feature selected list must contain explicit data IDs'), 'guid-e709e3464f2abfe2');
    }
    selected.push(element.value);
  }
  const removed = [...new Set(selected.filter(id => REMOVED_HOST_FEATURE_IDS.includes(id)))].sort();
  if (removed.length) onRemoved?.(removed);
  const validated = validateCapabilitySelection(graph, selected.filter(id => !removed.includes(id))) as HostFeatureId[];
  // The shared DAG permits an empty selection; a host configuration requires core.
  if (!validated.includes('wiki-core')) throw guidanceError(new Error('Host feature selection requires wiki-core'), 'guid-a7900400ce6fb967');
  return Object.freeze({ version: 1, selected: Object.freeze(validated.sort()) });
}

/** Config identity only, not a deployment, permission or endpoint-catalog hash. */
export function hostFeatureConfigFingerprint(input: unknown): string {
  const config = parseHostFeatureConfig(input);
  return createHash('sha256').update(JSON.stringify({ kind: 'host-features', ...config })).digest('hex');
}

/** Reviewed internal registration names, never namespace-prefix grants.
 * This snapshot comes from createServer's inventory and its tool factories.
 * Keep auth, safety, ordinary note task metadata, Canvas and MOC continuity in
 * core. Dedicated work boards/claims are optional.
 *
 * Resolve dynamic IDs/REST routes through the existing registry first and pass
 * its trusted descriptor.toolName. Do not use an untrusted caller-supplied name
 * paired with another endpoint, or an operation read-alias, as a bypass.
 * New/unmapped registrations stay disabled until explicitly classified here.
 */
const toolsByFeature: Record<HostFeatureId, readonly string[]> = {
  'wiki-core': [
    'manage_wiki_compilation',
    'manage_evolution_feedback', 'manage_evolution_cycle', 'get_evolution_context',
    'check_wiki_fidelity',
    'orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint',
    'read_note', 'write_note', 'patch_note', 'list_directory', 'delete_note', 'search_notes',
    'preview_delete_note', 'patch_multiple_notes', 'record_search_feedback', 'get_search_improvement_candidates',
    'move_note', 'move_file', 'read_multiple_notes', 'update_frontmatter', 'get_notes_info', 'get_frontmatter',
    'manage_tags', 'get_vault_stats', 'list_all_tags', 'preview_move_note', 'sync_note_revisions',
    'semantic_search_status', 'list_tasks', 'update_task', 'query_notes', 'get_revision_status',
    'initialize_revision_history', 'commit_changes', 'get_note_history', 'compare_note_revisions',
    'restore_note_revision', 'resolve_note_link', 'wiki_link', 'get_daily_note', 'daily_note',
    'find_orphan_notes', 'find_unresolved_links', 'get_outlinks', 'get_backlinks', 'get_note_outline', 'read_note_lines',
    'register_scope_account', 'login_scope', 'logout_scope', 'whoami_scope', 'change_scope_password',
    'update_agent_capabilities', 'get_scope_context', 'create_agent_scope', 'handoff_agent_scope',
    'resume_agent_scope', 'read_scoped_note', 'search_scoped_notes',
    'get_agent_profile', 'list_agent_profiles', 'update_agent_profile',
    'list_notices', 'read_notice', 'preview_notice', 'revise_notice', 'list_guidance_catalog',
    'read_references', 'list_audit_events', 'search_obsidian', 'report_content', 'list_moderation_reports', 'moderate_content',
    'check_reusable_configuration', 'preview_learning_configuration', 'save_work_state', 'resume_work_state',
    'initialize_llm_wiki', 'ingest_source', 'publish_knowledge', 'lint_wiki', 'report_wiki_issue', 'resolve_wiki_issue',
    'capture_wiki_note', 'clarify_wiki_note', 'distill_wiki_source', 'export_wiki_base', 'export_wiki_canvas',
    'get_wiki_answer_packet', 'get_wiki_applications', 'get_wiki_archive_finding_aid', 'get_wiki_argument_map',
    'get_wiki_authority_map', 'get_wiki_bases_view', 'get_wiki_canvas_health', 'get_wiki_canvas_view',
    'get_wiki_catalog', 'get_wiki_citation_graph', 'get_wiki_claim_matrix', 'get_wiki_composition_candidates',
    'get_wiki_context_pack', 'get_wiki_decision_register', 'get_wiki_duplicate_candidates', 'get_wiki_exception_board',
    'get_wiki_flow_health', 'get_wiki_graph_health', 'get_wiki_hierarchy_change_preview', 'get_wiki_home',
    'get_wiki_impact_report', 'get_wiki_inbox', 'get_wiki_inbox_plan', 'get_wiki_knowledge_gaps',
    'get_wiki_learning_path', 'get_wiki_lifecycle_transition_preview', 'get_wiki_link_context_health',
    'get_wiki_maintenance_debt', 'get_wiki_moc_candidates', 'get_wiki_moc_membership_preview',
    'get_wiki_moc_order_preview', 'get_wiki_moc_rebalance', 'get_wiki_neighborhood', 'get_wiki_next_actions',
    'get_wiki_note_template', 'get_wiki_organization_health', 'get_wiki_organization_manifest',
    'get_wiki_placement_candidates', 'get_wiki_policy', 'get_wiki_project_packet', 'get_wiki_promotion_candidates',
    'get_wiki_property_contract', 'get_wiki_property_migration_preview', 'get_wiki_quality_check',
    'get_wiki_recall_queue', 'get_wiki_reciprocal_link_preview', 'get_wiki_relation_set_preview',
    'get_wiki_retention_queue', 'get_wiki_review_dashboard', 'get_wiki_review_packet', 'get_wiki_review_queue',
    'get_wiki_source_comparison', 'get_wiki_source_lineage', 'get_wiki_source_trust', 'get_wiki_summary_candidates',
    'get_wiki_synthesis_candidates', 'get_wiki_topic_packet', 'get_wiki_term_change_preview', 'get_wiki_trail', 'get_wiki_unused_knowledge',
    'get_wiki_vocabulary_health', 'manage_wiki_moc_region', 'preflight_wiki_publish', 'preview_wiki_merge',
    'preview_wiki_split', 'propose_wiki_term_change', 'publish_decision_record', 'read_wiki_moc_region_status',
    'read_wiki_projection', 'read_wiki_saved_view', 'record_wiki_recall', 'resolve_wiki_term',
    'resurface_wiki_archives', 'resurface_wiki_knowledge', 'review_wiki_claim', 'review_wiki_note',
    'triage_wiki_note', 'update_wiki_projection',
  ],
  'document-search': ['get_document_outline', 'read_document', 'search_documents', 'get_resource_manifest', 'export_resource'],
  'personal-memory': [
    'memory_recall', 'memory_brief', 'memory_consolidate',
  ],
  'work-management': [
    'create_agent_task', 'read_agent_task', 'list_agent_tasks', 'update_agent_task',
    'manage_work_group', 'read_work_coverage', 'manage_work_project', 'read_work_board', 'read_work_packet',
    'read_work_review_context', 'read_work_staffing', 'claim_work_task', 'handoff_work_task', 'review_work_task',
  ],
  'skill-evolution': ['resolve_skill', 'record_skill_experience', 'manage_skill_candidate', 'evaluate_skill', 'promote_skill', 'rollback_skill'],
};

export const HOST_FEATURE_TOOL_MAP: Readonly<Record<string, HostFeatureId>> = Object.freeze(
  Object.fromEntries(HOST_FEATURE_IDS_V1.flatMap(feature => toolsByFeature[feature].map(tool => [tool, feature]))),
);

export function hostFeatureForTool(toolName: string): HostFeatureId | undefined {
  return typeof toolName === 'string' && Object.hasOwn(HOST_FEATURE_TOOL_MAP, toolName)
    ? HOST_FEATURE_TOOL_MAP[toolName] : undefined;
}

export interface HostFeatureEligibility {
  readonly feature?: HostFeatureId;
  readonly eligible: boolean;
  readonly reason: 'selected' | 'disabled' | 'unmapped';
  readonly permissionsGranted: false;
}

/** Selection only: caller capabilities, document rights, read-only mode, owner
 * consent, configured services/providers and operation-level guards still apply.
 * This performs no I/O, mutation, cleanup, model call or service initialization.
 * Re-enabling a feature has no migration/deletion semantics.
 */
export function hostFeatureEligibility(input: unknown, toolName: string): HostFeatureEligibility {
  const config = parseHostFeatureConfig(input);
  const feature = hostFeatureForTool(toolName);
  if (!feature) return Object.freeze({ eligible: false, reason: 'unmapped', permissionsGranted: false });
  const eligible = config.selected.includes(feature);
  return Object.freeze({ feature, eligible, reason: eligible ? 'selected' : 'disabled', permissionsGranted: false });
}
