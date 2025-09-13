// BFS via endast construction-kanter
export function findManhattanPath(g, startN, goalN) {
  if (startN === goalN) return { nodes:[startN], edges:[] };
  const q = [startN];
  const prevNode = new Map(), prevEdge = new Map();
  prevNode.set(startN, null);

  while (q.length) {
    const nid = q.shift();
    const inc = g.incidentEdges(nid, { kind:'construction' });
    for (const e of inc) {
      const other = (e.a === nid) ? e.b : e.a;
      if (!prevNode.has(other)) {
        prevNode.set(other, nid);
        prevEdge.set(other, e.id);
        q.push(other);
        if (other === goalN) break;
      }
    }
    if (prevNode.has(goalN)) break;
  }
  if (!prevNode.has(goalN)) return null;

  const nodes = []; const edges = [];
  let cur = goalN;
  while (cur != null) {
    nodes.push(cur);
    const p = prevNode.get(cur);
    if (p != null) edges.push(prevEdge.get(cur));
    cur = p;
  }
  nodes.reverse(); edges.reverse();
  return { nodes, edges };
}

export function hasConstructionPathBetween(g, a, b) {
  const p = findManhattanPath(g, a, b);
  return !!(p && p.edges && p.edges.length);
}
