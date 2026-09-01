/**
 * Read known-safe note paths in small parallel batches. The filesystem service
 * remains responsible for path validation and revision calculation.
 */
export async function readNotesInBatches(fileSystem, paths) {
    const unique = Array.from(new Set(paths));
    const notes = new Map();
    for (let start = 0; start < unique.length; start += 10) {
        const batch = await fileSystem.readMultipleNotes({
            paths: unique.slice(start, start + 10),
            includeContent: true,
            includeFrontmatter: true,
            knownRevisions: {},
        });
        for (const note of batch.successful)
            notes.set(note.path, note);
        if (batch.failed.length > 0)
            throw new Error(batch.failed[0].error);
    }
    return notes;
}
