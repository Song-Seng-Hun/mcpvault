export function navigationOrder(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
        return Number.MAX_SAFE_INTEGER;
    const order = Number(value);
    return Number.isInteger(order) && order >= 0 && order <= 1_000_000 ? order : Number.MAX_SAFE_INTEGER;
}
export function compareMocNavigation(left, right) {
    return navigationOrder(left.navOrder) - navigationOrder(right.navOrder)
        || String(left.title || left.path).localeCompare(String(right.title || right.path))
        || left.path.localeCompare(right.path);
}
const key = (path) => path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
const stem = (path) => key(path).replace(/\.(?:md|markdown|txt)$/, '');
const parentTarget = (value) => value.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split(/[|#]/)[0].trim();
/** Iterative preorder traversal keeps each branch together, even in deep vaults. */
export function buildMocNavigation(nodes) {
    const byPath = new Map(nodes.map(node => [key(node.path), node]));
    const targets = new Map();
    for (const node of nodes) {
        const pathKey = key(node.path);
        for (const name of new Set([pathKey, stem(node.path), pathKey.split('/').at(-1), stem(node.path).split('/').at(-1)])) {
            const paths = targets.get(name) || new Set();
            paths.add(pathKey);
            targets.set(name, paths);
        }
    }
    const parents = new Map();
    const children = new Map();
    const problems = new Map();
    const missingParents = [];
    const ambiguousParents = [];
    for (const node of nodes) {
        if (!node.parent?.trim())
            continue;
        const path = key(node.path);
        const matches = [...(targets.get(key(parentTarget(node.parent))) || [])];
        if (!matches.length || (matches.length === 1 && matches[0] === path)) {
            problems.set(path, 'unresolved_parent');
            missingParents.push({ path: node.path, parent: node.parent, reason: matches.length ? 'moc_parent_points_to_itself' : 'moc_parent_does_not_resolve_to_an_moc' });
        }
        else if (matches.length > 1) {
            problems.set(path, 'ambiguous_parent');
            ambiguousParents.push({ path: node.path, parent: node.parent, matches: matches.map(match => byPath.get(match).path), reason: 'moc_parent_matches_multiple_mocs' });
        }
        else {
            const parent = matches[0];
            parents.set(path, parent);
            const siblings = children.get(parent) || [];
            siblings.push(path);
            children.set(parent, siblings);
        }
    }
    const depths = new Map();
    const cycleNodes = new Set();
    const blockedNodes = new Set();
    const cycles = [];
    for (const start of byPath.keys()) {
        if (depths.has(start))
            continue;
        const trail = [];
        const positions = new Map();
        let current = start;
        while (current !== undefined && !depths.has(current) && !positions.has(current)) {
            positions.set(current, trail.length);
            trail.push(current);
            current = parents.get(current);
        }
        if (current !== undefined && positions.has(current)) {
            const cycle = trail.slice(positions.get(current));
            for (const member of cycle) {
                cycleNodes.add(member);
                depths.set(member, 0);
            }
            cycles.push({ nodes: cycle.map(member => byPath.get(member).path), reason: 'moc_parent_cycle' });
        }
        for (let index = trail.length - 1; index >= 0; index -= 1) {
            const path = trail[index];
            if (cycleNodes.has(path))
                continue;
            const parent = parents.get(path);
            if (parent && (cycleNodes.has(parent) || blockedNodes.has(parent) || problems.has(parent)))
                blockedNodes.add(path);
            depths.set(path, parent ? (depths.get(parent) || 0) + 1 : 0);
        }
    }
    const compare = (a, b) => compareMocNavigation(byPath.get(a), byPath.get(b));
    for (const siblings of children.values())
        siblings.sort(compare);
    const all = [...byPath.keys()].sort(compare);
    const roots = all.filter(path => !parents.has(path) && !problems.has(path));
    const starts = [...roots, ...all.filter(path => problems.has(path)), ...all.filter(path => cycleNodes.has(path))];
    const seen = new Set();
    const ordered = [];
    for (const start of starts) {
        const stack = [start];
        while (stack.length) {
            const path = stack.pop();
            if (seen.has(path))
                continue;
            seen.add(path);
            ordered.push(path);
            const siblings = children.get(path) || [];
            for (let index = siblings.length - 1; index >= 0; index -= 1)
                stack.push(siblings[index]);
        }
    }
    const items = ordered.map(path => {
        const node = byPath.get(path);
        const parent = parents.get(path);
        return {
            ...node,
            ...(parent && { resolvedParent: byPath.get(parent).path }),
            children: (children.get(path) || []).map(child => byPath.get(child).path),
            childTotal: children.get(path)?.length || 0,
            depth: depths.get(path) || 0,
            state: cycleNodes.has(path) ? 'cycle' : problems.get(path) || (blockedNodes.has(path) ? 'ancestor_problem' : parent ? 'nested' : 'root'),
        };
    });
    return { items, roots: roots.map(path => byPath.get(path).path), missingParents, ambiguousParents, cycles, explicitParentEdges: parents.size, maxDepth: items.reduce((max, item) => Math.max(max, item.depth), 0) };
}
