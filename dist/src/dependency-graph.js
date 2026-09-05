/** Exact SCC classification with explicit DFS frames, independent of the JS
 * call-stack depth. Preserve the original caller/input-rank ordering. */
export function classifyDependencyResidual(nodes, adjacency) {
    const nodeSet = new Set(nodes);
    const rank = new Map(nodes.map((node, index) => [node, index]));
    const indices = new Map(), lowLinks = new Map();
    const stack = [], onStack = new Set(), components = [];
    const frames = [];
    let nextIndex = 0;
    const enter = (node, parent) => {
        indices.set(node, nextIndex);
        lowLinks.set(node, nextIndex++);
        stack.push(node);
        onStack.add(node);
        frames.push({ node, parent, edges: (adjacency.get(node) || new Set()).values() });
    };
    for (const root of nodes) {
        if (indices.has(root))
            continue;
        enter(root);
        while (frames.length) {
            const frame = frames[frames.length - 1];
            const edge = frame.edges.next();
            if (!edge.done) {
                const target = edge.value;
                if (!nodeSet.has(target))
                    continue;
                if (!indices.has(target))
                    enter(target, frame.node);
                else if (onStack.has(target))
                    lowLinks.set(frame.node, Math.min(lowLinks.get(frame.node), indices.get(target)));
                continue;
            }
            frames.pop();
            const node = frame.node;
            if (lowLinks.get(node) === indices.get(node)) {
                const component = [];
                while (stack.length) {
                    const member = stack.pop();
                    onStack.delete(member);
                    component.push(member);
                    if (member === node)
                        break;
                }
                component.sort((left, right) => rank.get(left) - rank.get(right));
                components.push(component);
            }
            if (frame.parent !== undefined)
                lowLinks.set(frame.parent, Math.min(lowLinks.get(frame.parent), lowLinks.get(node)));
        }
    }
    const cycles = components.filter(component => component.length > 1 || Boolean(adjacency.get(component[0])?.has(component[0])))
        .sort((left, right) => rank.get(left[0]) - rank.get(right[0]));
    const cycleNodes = new Set(cycles.flat());
    return { cycles, cycleNodes, blocked: nodes.filter(node => !cycleNodes.has(node)) };
}
