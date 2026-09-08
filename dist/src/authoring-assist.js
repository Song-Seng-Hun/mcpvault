import { guidanceError, guidanceText } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { getOrganizationPropertyContract, getOrganizationRelationContract, organizationNoteTemplate } from './organization.js';
export function propertyContractFingerprint() {
    return createHash('sha256').update(JSON.stringify({ fields: getOrganizationPropertyContract(), relations: getOrganizationRelationContract() })).digest('hex');
}
export function authoringAssist(noteKind, context = {}) {
    const template = organizationNoteTemplate(noteKind);
    const intent = context.intent ?? 'knowledge';
    if (!['knowledge', 'capture', 'reply', 'new_topic'].includes(intent))
        throw guidanceError(new Error('Unsupported authoring intent'), 'guid-d22b89bb4b87fa2f');
    if (context.slug !== undefined && !/^[a-z0-9][a-z0-9-]{0,119}$/.test(context.slug))
        throw guidanceError(new Error('Invalid post slug'), 'guid-233dce3fd1380775');
    const provided = context.provided ?? {};
    const required = intent === 'reply' ? ['slug', 'content'] : intent === 'new_topic' ? ['slug', 'title', 'content'] : intent === 'capture' ? ['content'] : ['title', 'content', ...(noteKind === 'project' ? ['desired_outcome', 'next_action'] : [])];
    const contracts = getOrganizationPropertyContract();
    return {
        contractFingerprint: propertyContractFingerprint(), defaults: template.properties,
        fields: contracts.filter(field => Object.hasOwn(template.properties, field.name) || field.name === 'title'),
        missing: required.filter(key => !(key === 'slug' ? context.slug : provided[key])),
        nextAction: { endpointId: intent === 'reply' ? 'community.comment' : intent === 'new_topic' ? 'community.post' : intent === 'capture' ? 'wiki.capture' : 'wiki.preflight',
            arguments: { ...(context.slug && { slug: context.slug }) },
            instruction: intent === 'knowledge' ? 'Search existing knowledge first. Write the draft via revision-checked notes.write, then preflight its returned path and revision before publication.' : 'Supply the missing inputs using the endpoint schema. This scaffold performs no writes; verify the returned target after execution.' },
        normalization: { mechanical: ['CRLF to LF in a revision-checked preview'], semantic: ['scope', 'evidence', 'summary freshness', 'lifecycle', 'relations'], instruction: guidanceText('guid-89e05614c6c06783', 'Do not refresh evidence or summary fingerprints merely to remove lint warnings. Review exact notes.change_set dry-run before applying formatting.') },
    };
}
export function hostPluginBundle() {
    const fingerprint = `sha256:${propertyContractFingerprint()}`;
    const fields = getOrganizationPropertyContract().filter(field => ['title', 'tags'].includes(field.name)).map(field => ({
        name: field.name, type: field.type === 'list' ? 'Multi' : 'Input', id: `mcpvault-${field.name}`, path: '',
        options: field.type === 'list' ? { sourceType: 'ValuesList', valuesList: {} } : {},
    }));
    return { fingerprint, templates: [{ path: 'Templates/MCPVault/Inbox.md', content: `---\n${stringify({ note_kind: 'fleeting', lifecycle: 'inbox', title: '', tags: [], fileClass: 'Inbox', contract_fingerprint: fingerprint })}---\n# {{VALUE:title}}\n\n{{VALUE:content}}\n` }],
        fileClassesPath: 'Templates/MCPVault/FileClasses', fileClasses: [{ path: 'Templates/MCPVault/FileClasses/Inbox.md', content: `---\n${stringify({ fields, contract_fingerprint: fingerprint })}---\n# Inbox property form\n\nDerived from wiki.property_contract. Host-only convenience, not an access boundary.\n` }] };
}
