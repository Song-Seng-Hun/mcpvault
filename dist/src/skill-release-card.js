import { skillMetadataAxis, skillMetadataSection, SKILL_METADATA_SECTIONS } from './skill-passport.js';
import { skillPotentialImpact } from './skill-impact.js';
import { IMPACT_AXES } from './skill-descriptor.js';
/** Public projection of reviewed release metadata only. Private review artifacts and
 * source declarations are never promoted to approved metadata by this adapter. */
export function reviewedSkillCard(manifest, release, max, p, descriptor) {
    const section = skillMetadataSection(p.section), axis = skillMetadataAxis(p.axis);
    if (axis && section !== 'impact')
        throw Error('Reviewed skill unavailable');
    const read = (resourceId) => ({ endpointId: 'skill.resolve', arguments: { skillId: manifest.skillId, view: 'procedure', resourceId, expectedRelease: release, maxChars: 12000 } });
    const expand = { endpointId: 'skill.resolve', arguments: { skillId: manifest.skillId, view: 'metadata', section, ...(axis ? { axis } : {}), expectedRelease: release, maxChars: 12000 } };
    const base = { skillId: manifest.skillId, view: 'metadata', section, ...(axis ? { axis } : {}), status: 'reviewed_limited', releaseRevision: release,
        executionAuthorized: false, limitations: manifest.limitations, useWhen: manifest.useWhen, avoidWhen: manifest.avoidWhen,
        notice: 'Reviewed procedural data only. Existing tool permissions still apply. Missing metadata is unknown, not low risk.',
        metadataScope: descriptor ? 'reviewed_release_descriptor' : 'reviewed_release_conditions_only' };
    let detail;
    if (section === 'description' && descriptor)
        detail = { descriptor, missing: ['observed_usage'], nextAction: read(manifest.mainResource) };
    else if (section === 'summary' || section === 'description')
        detail = { card: { functions: manifest.retainedFunctions, ...(descriptor ? {
                    kind: descriptor.kind, domains: descriptor.domains, purpose: descriptor.purpose, keywords: descriptor.keywords, example: descriptor.examples[0] ?? null
                } : {}) },
            resources: manifest.resources.map(r => ({ resourceId: r.id, title: r.title, kind: r.kind, read: read(r.id) })),
            missing: [...(descriptor ? [] : ['reviewed_descriptor']), 'observed_usage'], nextAction: read(manifest.mainResource),
            ...(descriptor ? { requiredReads: SKILL_METADATA_SECTIONS.filter(s => s !== 'summary').map(s => ({ endpointId: 'skill.resolve', arguments: { skillId: manifest.skillId, view: 'metadata', section: s, expectedRelease: release, maxChars: 12000 } })) } : {}) };
    else if (section === 'impact') {
        const impact = skillPotentialImpact(descriptor);
        detail = { impact: axis ? { ...impact, axes: { [axis]: impact.axes[axis] } } : impact,
            claims: (descriptor?.impactClaims ?? []).filter(c => !axis || c.axis === axis), missing: descriptor ? [] : ['reviewed_impact_assessment'], nextAction: read(manifest.mainResource) };
    }
    else if (section === 'connections')
        detail = { connections: descriptor?.connections ?? null, actualHostGrants: 'not_supplied', installation: 'not_performed', missing: descriptor ? [] : ['reviewed_connections'], nextAction: read(manifest.mainResource) };
    else
        detail = { usage: null, missing: ['verified_usage_telemetry'], nextAction: read(manifest.mainResource) };
    const full = { ...base, ...detail, partial: false };
    if (JSON.stringify(full).length <= max)
        return full;
    if (max === 12000 && section === 'impact' && !axis) {
        const requiredReads = IMPACT_AXES.map(axis => ({ ...expand, arguments: { ...expand.arguments, axis } }));
        const split = { ...base, partial: true, omitted: ['section_detail'], requiredReads, nextAction: requiredReads[0] };
        if (JSON.stringify(split).length <= max)
            return split;
    }
    // Never omit restrictions while still showing functional recommendations.
    // At the maximum budget, registered resource reads provide offset continuation;
    // repeating the same oversized metadata request would never make progress.
    const nextAction = max === 12000 ? read(manifest.descriptorResource ?? manifest.mainResource) : expand;
    const partial = { ...base, partial: true, omitted: ['section_detail'], nextAction };
    if (JSON.stringify(partial).length <= max)
        return partial;
    return { skillId: manifest.skillId, view: 'metadata', section, status: 'reviewed_limited', releaseRevision: release, executionAuthorized: false,
        partial: true, omitted: ['conditions', 'section_detail'], nextAction };
}
