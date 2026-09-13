import { guidanceText } from './guidance-runtime.js';
/** Bounded review instructions, not read receipts or a shortcut to ready. */
export function learningRevalidation(input) {
    const targets = new Map();
    if (input.rootChanged)
        targets.set(input.root.path, input.root.revision);
    for (const entry of input.changedEntries)
        if (entry.currentRevision)
            targets.set(entry.path, entry.currentRevision);
    const reads = [...targets].slice(0, 8).map(([path, revision]) => ({
        endpointId: 'mcp.read_note_lines', arguments: { path, expectedRevision: revision, startLine: 1, endLine: 40, maxChars: 2000 },
    }));
    return {
        state: 'review_required', understandingVerified: false,
        pathReviewRequired: input.structureChanged || input.sourceSnapshotChanged,
        changedReadsTotal: targets.size, reads, readsOmitted: Math.max(0, targets.size - reads.length),
        checkpoint: { endpointId: 'continuity.save', requiredArguments: ['topic', 'summary', 'nextAction', 'expectedRevision', 'learningProgress'] },
        guidance: guidanceText('guid-df49b207811a0768', 'Read changed sources at these revisions; follow read continuations for omitted content. Review route/dependencies when required. Save reviewed progress using the resume checkpoint revision, preserving only still-valid completedThrough. Read receipts do not validate understanding; its checks remain separate.'),
    };
}
