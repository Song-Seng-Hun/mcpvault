import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { validateCapabilitySelection } from './capability-graph.js';
/** Explicit v1 snapshot. Adding a future feature must not expand saved selections. */
export const HOST_FEATURE_IDS_V1 = Object.freeze([
    'wiki-core', 'document-search', 'personal-memory', 'work-management', 'collaboration',
    'ideation-research', 'explanation-translation', 'benchmarks', 'economy', 'roleplay', 'skill-evolution',
]);
export const DEFAULT_HOST_FEATURE_CONFIG = Object.freeze({
    version: 1, selected: Object.freeze(['wiki-core']),
});
// Features depend only on core. Cross-feature operations require their own
// integration checks; they must never silently enable a whole unrelated feature.
const graph = HOST_FEATURE_IDS_V1.map(id => ({
    id, requires: id === 'wiki-core' ? [] : ['wiki-core'], excludes: [], cost: 0,
}));
/** Strict data-only object parsing. No coercion, getters, execution or defaults.
 * The host owns bounded JSON/file loading and chooses the default explicitly. */
export function parseHostFeatureConfig(input) {
    if (!input || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
        throw new Error('Host feature configuration must be a plain data object');
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes('version') || !keys.includes('selected')) {
        throw new Error('Host feature configuration requires exactly version and selected fields');
    }
    const fields = Object.getOwnPropertyDescriptors(input);
    if (Object.values(fields).some(field => !Object.hasOwn(field, 'value') || !field.enumerable)) {
        throw new Error('Host feature configuration fields must be enumerable data');
    }
    if (fields.version.value !== 1)
        throw new Error('Unsupported host feature configuration version');
    const list = fields.selected.value;
    if (!Array.isArray(list) || types.isProxy(list) || Object.getPrototypeOf(list) !== Array.prototype
        || list.length < 1 || list.length > HOST_FEATURE_IDS_V1.length
        || Reflect.ownKeys(list).length !== list.length + 1) {
        throw new Error('Host feature selected list outside bounds');
    }
    const selected = [];
    for (let i = 0; i < list.length; i++) {
        const element = Object.getOwnPropertyDescriptor(list, String(i));
        if (!element || !Object.hasOwn(element, 'value') || !element.enumerable || typeof element.value !== 'string') {
            throw new Error('Host feature selected list must contain explicit data IDs');
        }
        selected.push(element.value);
    }
    const validated = validateCapabilitySelection(graph, selected);
    // The shared DAG permits an empty selection; a host configuration requires core.
    if (!validated.includes('wiki-core'))
        throw new Error('Host feature selection requires wiki-core');
    return Object.freeze({ version: 1, selected: Object.freeze(validated.sort()) });
}
/** Config identity only, not a deployment, permission or endpoint-catalog hash. */
export function hostFeatureConfigFingerprint(input) {
    const config = parseHostFeatureConfig(input);
    return createHash('sha256').update(JSON.stringify({ kind: 'host-features', ...config })).digest('hex');
}
/** Reviewed internal registration names, never namespace-prefix grants.
 * This snapshot comes from createServer's inventory and its tool factories.
 * Keep auth, safety, ordinary note task metadata, Canvas and MOC continuity in
 * core. Dedicated work boards/claims are optional; social XP is collaboration,
 * whereas wallets/quests are economy. Story tools belong to roleplay.
 *
 * Resolve dynamic IDs/REST routes through the existing registry first and pass
 * its trusted descriptor.toolName. Do not use an untrusted caller-supplied name
 * paired with another endpoint, or an operation read-alias, as a bypass.
 * New/unmapped registrations stay disabled until explicitly classified here.
 */
const toolsByFeature = {
    'wiki-core': [
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
        'list_journal_entries', 'read_journal_entry', 'write_journal_entry', 'save_item', 'unsave_item', 'list_saved_items',
    ],
    'work-management': [
        'create_agent_task', 'read_agent_task', 'list_agent_tasks', 'update_agent_task',
        'manage_work_group', 'read_work_coverage', 'manage_work_project', 'read_work_board', 'read_work_packet',
        'read_work_review_context', 'read_work_staffing', 'claim_work_task', 'handoff_work_task', 'review_work_task',
    ],
    collaboration: [
        'comment_on_blog_post', 'delete_blog_comment', 'delete_blog_post', 'edit_blog_comment', 'list_blog_comments',
        'list_blog_posts', 'list_mentions', 'publish_blog_post', 'read_blog_post', 'update_community_status',
        'public_federation_get', 'public_federation_list', 'public_federation_pull', 'public_federation_retry',
        'manage_community_participation', 'record_community_participation',
        'archive_chat_room', 'create_chat_room', 'delete_chat_message', 'edit_chat_message', 'list_chat_rooms',
        'read_chat_room', 'send_chat_message', 'list_whispers', 'send_whisper', 'read_context',
        'list_notifications', 'mark_notifications_read', 'get_reputation',
        'accept_blog_comment', 'delete_guestbook_entry', 'list_author_activity', 'list_blog_series', 'list_guestbook',
        'list_popular_posts', 'list_reactions', 'list_watched_targets', 'toggle_reaction', 'unaccept_blog_comment',
        'unwatch_target', 'watch_target', 'write_guestbook_entry',
    ],
    'ideation-research': [
        'get_wiki_bridge_candidates', 'branch_idea', 'contribute_idea', 'contribute_workshop', 'create_idea',
        'create_workshop', 'evaluate_idea', 'list_ideas', 'list_workshop_methods', 'list_workshops', 'read_idea',
        'read_workshop', 'read_workshop_facilitation', 'synthesize_workshop', 'update_idea_status',
        'update_workshop_facilitation', 'update_workshop_phase', 'read_workshop_research', 'update_workshop_research',
    ],
    'explanation-translation': [
        'list_explanations', 'read_explanation', 'claim_explanation', 'release_explanation', 'submit_explanation', 'review_explanation',
    ],
    benchmarks: ['list_benchmarks', 'read_benchmark', 'submit_benchmark', 'review_benchmark', 'finalize_benchmark'],
    economy: ['read_economy_wallet', 'read_quest_market', 'manage_quest_contract', 'review_quest_contract'],
    roleplay: [
        'manage_roleplay_world', 'manage_roleplay_character', 'manage_roleplay_scene', 'read_roleplay_context',
        'submit_roleplay_action', 'resolve_roleplay_action', 'read_roleplay_history', 'correct_roleplay_turn',
        'manage_roleplay_evolution', 'manage_roleplay_trpg',
        'manage_story_project', 'manage_story_artifact', 'manage_story_sequence', 'read_story_context',
        'manage_story_review', 'adopt_story_artifact', 'manage_story_session', 'manage_story_export', 'manage_story_visual',
    ],
    'skill-evolution': ['resolve_skill', 'record_skill_experience', 'manage_skill_candidate', 'evaluate_skill', 'promote_skill', 'rollback_skill'],
};
export const HOST_FEATURE_TOOL_MAP = Object.freeze(Object.fromEntries(HOST_FEATURE_IDS_V1.flatMap(feature => toolsByFeature[feature].map(tool => [tool, feature]))));
export function hostFeatureForTool(toolName) {
    return typeof toolName === 'string' && Object.hasOwn(HOST_FEATURE_TOOL_MAP, toolName)
        ? HOST_FEATURE_TOOL_MAP[toolName] : undefined;
}
/** Selection only: caller capabilities, document rights, read-only mode, owner
 * consent, configured services/providers and operation-level guards still apply.
 * This performs no I/O, mutation, cleanup, model call or service initialization.
 * Re-enabling a feature has no migration/deletion semantics.
 */
export function hostFeatureEligibility(input, toolName) {
    const config = parseHostFeatureConfig(input);
    const feature = hostFeatureForTool(toolName);
    if (!feature)
        return Object.freeze({ eligible: false, reason: 'unmapped', permissionsGranted: false });
    const eligible = config.selected.includes(feature);
    return Object.freeze({ feature, eligible, reason: eligible ? 'selected' : 'disabled', permissionsGranted: false });
}
