import { parseSkillDescriptor, IMPACT_AXES } from './skill-descriptor.js';
import { skillPotentialImpact } from './skill-impact.js';
import { budget, fingerprint } from './skill-evolution-store.js';
export const SKILL_METADATA_SECTIONS = ['summary', 'description', 'impact', 'connections', 'usage'];
export function skillMetadataSection(value) {
    if (value === undefined)
        return 'summary';
    if (!SKILL_METADATA_SECTIONS.includes(value))
        throw new Error('Invalid skill metadata section');
    return value;
}
export function skillMetadataAxis(value) {
    if (value === undefined)
        return undefined;
    if (!IMPACT_AXES.includes(value))
        throw new Error('Invalid skill impact axis');
    return value;
}
/** Read-only projection. Host assessment/approval and caller declarations stay distinct. */
export function skillPassport(id, b, section, usage, maxChars, axis) {
    const max = budget(maxChars), descriptor = b.declaration === undefined ? undefined : parseSkillDescriptor(b.declaration), impact = skillPotentialImpact(descriptor);
    const bundleRevision = fingerprint(b.sourceGuards);
    const action = (next, nextAxis) => ({ endpointId: 'skill.resolve', arguments: { skillId: id, view: 'metadata', section: next, ...(nextAxis ? { axis: nextAxis } : {}), maxChars: 12000,
            expectedRevision: b.revision, expectedSourceRevision: b.source.revision, expectedBundleRevision: bundleRevision } });
    const base = { skillId: id, view: 'metadata', section, ...(axis ? { axis } : {}), basis: { source: b.source, selected: { path: b.path, revision: b.revision }, bundleRevision },
        declarationTrust: 'unverified_source', hostApproval: 'not_supplied', sourceDeclarationDrift: b.path !== b.source.path || b.revision !== b.source.revision,
        partial: false, notice: 'Discovery and potential impact only. No execution, policy/legal clearance or quarantine release.' };
    let detail;
    if (section === 'impact')
        detail = { impact: axis ? { ...impact, axes: { [axis]: impact.axes[axis] } } : impact,
            scope: axis ? 'single_axis' : 'all_axes', claims: (descriptor?.impactClaims ?? []).filter(c => !axis || c.axis === axis) };
    else if (section === 'connections')
        detail = { connections: descriptor?.connections ?? null, actualHostGrants: 'not_observed', installation: 'not_performed' };
    else if (section === 'description')
        detail = { descriptor: descriptor ?? null, missing: descriptor ? [] : ['declaration'] };
    else if (section === 'usage')
        detail = { usage: usage ? { ...usage, coUsed: usage.coUsed.map(({ path: _, ...peer }) => peer) } : null };
    else
        detail = { card: descriptor ? { kind: descriptor.kind, domains: descriptor.domains, purpose: descriptor.purpose,
                keywords: descriptor.keywords, example: descriptor.examples[0] ?? null } : null,
            impactLevels: Object.fromEntries(Object.entries(impact.axes).map(([k, v]) => [k, v.level])),
            missing: [...(descriptor ? [] : ['declaration']), ...((descriptor?.kind === 'tool' || descriptor?.kind === 'hybrid') && !descriptor.examples.length ? ['tool_examples'] : []), 'host_safety_review'],
            requiredReads: SKILL_METADATA_SECTIONS.filter(s => s !== 'summary').map(s => action(s)) };
    const full = { ...base, ...detail };
    if (JSON.stringify(full).length <= max)
        return full;
    // Never cut JSON or silently label omitted evidence as complete.
    if (max === 12000 && section === 'impact' && !axis)
        return { ...base, partial: true, omitted: ['section_detail'],
            requiredReads: IMPACT_AXES.map(a => action('impact', a)), nextAction: action('impact', IMPACT_AXES[0]) };
    const small = { ...base, partial: true, omitted: ['section_detail'], nextAction: action(section, axis) };
    if (JSON.stringify(small).length <= max)
        return small;
    return { skillId: id, view: 'metadata', section, partial: true, omitted: ['basis', 'section_detail'], nextAction: action(section, axis) };
}
