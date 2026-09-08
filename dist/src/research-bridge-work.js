import { isModerationHidden } from './moderation-policy.js';
import { endpointIdForTool } from './endpoint-registry.js';
export function researchWorkIds(researchKey) {
    if (!/^[a-f0-9]{64}$/.test(researchKey))
        throw Error('Invalid research key');
    const taskId = `research-${researchKey.slice(0, 48)}`;
    return { taskId, taskPath: `Community/Tasks/${taskId}.md`, workshopId: taskId, workshopPath: `Community/Workshops/${taskId}.md` };
}
export async function researchWorkPacket(fs, access, params) {
    try {
        return await readResearchWorkPacket(fs, access, params);
    }
    catch {
        return { state: 'unavailable' };
    }
}
async function readResearchWorkPacket(fs, access, params) {
    const ids = researchWorkIds(params.researchKey);
    if (!params.inputs.length || params.inputs.length > 4 || params.query.length > 1000)
        throw Error('Invalid research inputs');
    if (params.publicRequestId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(params.publicRequestId))
        throw Error('Invalid public retry key');
    for (const input of params.inputs) {
        try {
            const p = access.resolveExternalPath(input.path, params.principal);
            if (!access.canAccessPhysicalPath(p, params.principal) || /^(_scopes|_whispers)\//i.test(p.replace(/\\/g, '/'))
                || !access.canReferenceFrom(ids.taskPath, p))
                return { state: 'private_research' };
        }
        catch {
            return { state: 'private_research' };
        }
    }
    if (!access.canAccessPhysicalPath(ids.taskPath, params.principal))
        return { state: 'unavailable' };
    // Existence is used only to distinguish unavailable from absent. Never return hidden metadata.
    const exists = await fs.noteExists(ids.taskPath);
    const notes = await fs.readNoteMetadata([ids.taskPath], p => access.canAccessPhysicalPath(p, params.principal), { fresh: true, strict: true });
    const note = notes[0];
    if (exists && !note)
        return { state: 'unavailable' };
    if (note) {
        const fm = note.frontmatter;
        if (isModerationHidden(fm) || fm.mcpvault_type !== 'agent_task' || fm.task_id !== ids.taskId)
            return { state: 'unavailable' };
        const packet = { state: ['cancelled', 'blocked'].includes(String(fm.status)) ? 'parked' : fm.status === 'completed' ? 'completed' : 'existing',
            taskId: ids.taskId, ...(note.revision && { revision: note.revision }),
            nextAction: { endpointId: fm.project_id ? 'work.packet' : endpointIdForTool('read_agent_task'), arguments: { taskId: ids.taskId, maxChars: 3000,
                    ...(!fm.project_id && { includeContent: false, referenceLimit: 3, referenceMaxChars: 1000 }) } } };
        const workshopExists = await fs.noteExists(ids.workshopPath);
        const workshop = (await fs.readNoteMetadata([ids.workshopPath], p => access.canAccessPhysicalPath(p, params.principal), { fresh: true, strict: true }))[0];
        if (workshopExists && !workshop || workshop && (isModerationHidden(workshop.frontmatter) || workshop.frontmatter.mcpvault_type !== 'workshop' || workshop.frontmatter.workshop_id !== ids.workshopId))
            return { state: 'unavailable' };
        if (workshop) {
            packet.workshopAction = { endpointId: 'workshop.read', arguments: { workshopId: ids.workshopId, maxChars: 3000 } };
            return packet;
        }
        if (fm.project_id && fm.status === 'in_progress' && params.principal && fm.assignee_account_id === params.principal.accountId) {
            packet.workshopAction = { endpointId: 'workshop.create', arguments: { workshopId: ids.workshopId,
                    requestId: params.publicRequestId || `bridge-workshop-${params.researchKey.slice(0, 48)}`,
                    researchWork: { taskId: ids.taskId, expectedRevision: note.revision, expectedGeneration: fm.claim_generation },
                    title: 'Cross-domain research', prompt: `Research ${params.researchKey}. ${params.query}`,
                    references: params.inputs.map(i => i.path), agenda: ['Diverge', 'Counterexamples and prior work', 'Evaluate', 'Synthesize', 'Verification plan', 'Review results'] } };
        }
        return packet;
    }
    if (!params.projectId || !params.principal)
        return { state: 'needs_project' };
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(params.projectId))
        throw Error('Invalid research project');
    return { state: 'proposed', taskId: ids.taskId, createAction: { endpointId: endpointIdForTool('create_agent_task'), arguments: {
                taskId: ids.taskId, projectId: params.projectId, expectedRevision: 'missing', requestId: ids.taskId,
                title: 'Investigate a cross-domain connection', description: `Research key: ${params.researchKey}\nQuestion: ${params.query}\nInputs:\n${params.inputs.map(i => `[[${i.path}]] revision ${i.revision}`).join('\n')}\nPreserve mapping, counterexamples, prior-work search and minimum test. Web unavailable means verification pending.`,
                completionCriteria: ['Record mapping, assumptions and counterexamples', 'Record prior-work status and exact search coverage', 'Preserve test criteria, results and next question'],
            } } };
}
