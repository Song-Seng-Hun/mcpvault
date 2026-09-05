/** The dashboard is a set of overlapping samples, not a disjoint task count. */
export function packReviewDashboard(result, maxChars, prettyPrint = false) {
    const fits = (value) => JSON.stringify(value, null, prettyPrint ? 2 : undefined).length <= maxChars;
    if (fits(result))
        return result;
    const sections = result.sections;
    const collectionKeys = ['inbox', 'projectsAndTasks', 'projectReadiness', 'due', 'scheduled',
        'waiting', 'dependencyBlocked', 'someday', 'knowledge'];
    const epistemicKeys = ['questions', 'hypotheses', 'experiments', 'assumptions'];
    const compactRow = (row) => ({
        ...Object.fromEntries(['path', 'revision', 'kind', 'taskStatus', 'readiness', 'dueAt', 'scheduledAt',
            'overdue', 'scheduled', 'missingNextAction', 'waitingAgeDays', 'followUpNeeded', 'followUpReason',
            'epistemicStatus'].filter(key => row[key] !== undefined).map(key => [key, row[key]])),
        detailsOmitted: true,
        ...(typeof row.path === 'string' && { readAction: { endpointId: 'notes.read', arguments: { path: row.path, maxChars: 8000 } } }),
    });
    const trim = (collection, count, concise) => {
        const items = collection.items.slice(0, count).map(row => concise ? compactRow(row) : row);
        return { ...(concise ? { total: collection.total, ...(collection.scope && { scope: collection.scope }), detailsOmitted: true } : collection),
            items, truncated: Boolean(collection.truncated) || items.length < collection.total };
    };
    const graphAction = { endpointId: 'wiki.graph_health', arguments: { limit: 1, maxChars: 8000 } };
    // Graph summaries retain numeric signals, never string snippets or copied
    // bodies. Omitted graph lists must not appear complete or empty-and-healthy.
    const numericGraph = (value) => Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
        if (key === 'items' || key === 'truncated')
            return [];
        if (typeof entry === 'number' || typeof entry === 'boolean')
            return [[key, entry]];
        if (entry && typeof entry === 'object' && !Array.isArray(entry))
            return [[key, numericGraph(entry)]];
        return [];
    }));
    const graphSummary = { ...numericGraph(sections.graph), truncated: true, detailsOmitted: true, nextAction: graphAction };
    for (const concise of [false, true]) {
        for (const count of [2, 1]) {
            const value = {
                purpose: 'Review samples only; read current sources before changing them.',
                sections: {
                    ...Object.fromEntries(collectionKeys.map(key => [key, trim(sections[key], count, concise)])),
                    epistemic: Object.fromEntries(epistemicKeys.map(key => [key, trim(sections.epistemic[key], count, concise)])),
                    graph: concise ? graphSummary : sections.graph,
                }, truncated: true, detailsOmitted: true,
            };
            if (fits(value))
                return value;
        }
    }
    // One useful inspection when section summaries cannot fit. This is an
    // explicit category priority over bounded samples, not a global ranking.
    const priority = [
        ['due', sections.due, 'wiki.review_dashboard'],
        ['dependencyBlocked', sections.dependencyBlocked, 'wiki.flow_health'],
        ['waiting', sections.waiting, 'wiki.review_dashboard'],
        ['projectsAndTasks', sections.projectsAndTasks, 'wiki.review_dashboard'],
        ['inbox', sections.inbox, 'wiki.inbox'],
        ['knowledge', sections.knowledge, 'wiki.review_queue'],
        ...['experiments', 'questions', 'hypotheses', 'assumptions'].map(key => [`epistemic.${key}`, sections.epistemic[key], 'wiki.review_dashboard']),
        ['someday', sections.someday, 'wiki.review_dashboard'],
        ['scheduled', sections.scheduled, 'wiki.review_dashboard'],
        ['projectReadiness', sections.projectReadiness, 'wiki.review_dashboard'],
    ];
    const focus = priority.find(([, collection]) => collection.total > 0 || collection.items.length > 0);
    if (!focus) {
        return { truncated: true, detailsOmitted: true,
            message: 'No work-list sample selected. Graph details are omitted, not certified healthy.', nextAction: graphAction };
    }
    const [section, collection, endpointId] = focus;
    const row = collection.items[0];
    if (row && typeof row.path === 'string') {
        const value = { selected: { section, path: row.path, ...(row.revision && { revision: row.revision }) },
            nextAction: { endpointId: 'notes.read', arguments: { path: row.path, maxChars: 8000 } },
            truncated: true, detailsOmitted: true };
        if (fits(value))
            return value;
    }
    else if (endpointId !== 'wiki.review_dashboard') {
        return { section, truncated: true, detailsOmitted: true,
            message: 'This category has review work but no row fits its internal preview.',
            nextAction: { endpointId, arguments: { limit: 1, maxChars: 8000 } } };
    }
    if (maxChars < 18000 || prettyPrint) {
        const retry = { truncated: true, detailsOmitted: true, message: 'Retry the same review. No targets skipped.',
            nextAction: { endpointId: 'wiki.review_dashboard', reuseOriginalArguments: true,
                overrides: { limit: 1, maxChars: 18000, prettyPrint: false } } };
        if (fits(retry))
            return retry;
    }
    throw new Error('Review target exceeds the response ceiling; no targets skipped. Inspect source paths directly.');
}
