import { IMPACT_AXES } from './skill-descriptor.js';
const c = (axis, level, scenario, assumption) => ({ axis, level, scenario, assumption });
const RULES = {
    read_public: [c('data', 'low', 'Incorrect handling can misrepresent public information.', 'Only public input is accessible.')],
    read_private: [c('data', 'high', 'Private input can appear in generated output.', 'The host grants access to private input.')],
    write_workspace: [c('assets', 'high', 'Workspace files can be overwritten or corrupted.', 'The host grants workspace writes.')],
    delete_data: [c('assets', 'critical', 'Accessible data can be permanently lost.', 'Deletion is allowed without a recoverable copy.')],
    read_credentials: [c('accounts', 'critical', 'Accessible credentials can enable account takeover.', 'The runtime can read usable credentials.')],
    modify_account: [c('accounts', 'critical', 'Account ownership, permissions or recovery can be changed.', 'The account API grants those operations.')],
    write_environment: [c('system', 'critical', 'Future processes can load altered configuration or executables.', 'Persistent host environment changes are permitted.')],
    network_send: [c('data', 'high', 'Input supplied to the sender can leave the trusted environment.', 'Egress to an external recipient is permitted.')],
    install_dependencies: [c('system', 'critical', 'Dependency code can affect the runtime and inherited permissions.', 'Installation executes unconfined third-party code.')],
    start_process: [c('system', 'critical', 'A child process can affect resources available to its identity.', 'The child is not restricted by an enforced sandbox.')],
    register_mcp: [c('system', 'critical', 'A new server can expose additional actions and inherited resources.', 'The host permits registration and activation.')],
    register_hook: [c('system', 'critical', 'A persistent callback can run during later unrelated work.', 'The host permits installation and activation.')],
    financial_transaction: [c('assets', 'critical', 'Funds can be transferred or committed up to the granted account limits.', 'A valid financial account and transaction authority are available.')],
    irreversible_action: [c('assets', 'critical', 'A permitted irreversible action can create unrecoverable loss.', 'The action reaches an actual external or durable asset.')],
};
const weight = { unknown: -1, low: 0, moderate: 1, high: 2, critical: 3 };
/** Declarative worst-case consequences, not a likelihood estimate or a safety certificate. */
export function skillPotentialImpact(descriptor) {
    const axes = Object.fromEntries(IMPACT_AXES.map(axis => [axis, { level: 'unknown',
            scenarios: [], assumptions: [], basis: [] }]));
    const add = (rule, basis) => {
        const axis = axes[rule.axis];
        if (weight[rule.level] > weight[axis.level])
            axis.level = rule.level;
        axis.scenarios.push(rule.scenario);
        axis.assumptions.push(rule.assumption);
        axis.basis.push(basis);
    };
    const effects = [...new Set([...(descriptor?.effects ?? []), ...(descriptor?.connections.flatMap(c => c.effects) ?? [])])];
    for (const effect of effects)
        for (const rule of RULES[effect])
            add(rule, `declared_effect:${effect}`);
    if (effects.includes('network_send') && (effects.includes('read_private') || effects.includes('read_credentials')))
        add(c('data', 'critical', 'Private data or credentials can be transmitted outside the trust boundary.', 'Both read access and external egress are granted to the same data flow.'), 'combined_declared_effects');
    for (const claim of descriptor?.impactClaims ?? [])
        add(c(claim.axis, claim.level, claim.scenario, claim.assumptions.join('; ') || 'Author assumptions not supplied.'), 'unverified_author_claim');
    return { version: 1, meaning: 'potential_consequence_not_malice_or_probability', coverage: descriptor ? 'declared_capabilities_only' : 'unknown',
        maliciousness: 'not_assessed', residualRisk: 'not_assessed', permissionGranted: false,
        limit: 'Uninspected code or dependencies may exceed these declared scenarios. This analysis grants no authority.', axes };
}
