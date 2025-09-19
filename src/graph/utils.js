export function incidentEdgesOfObj(graph, nodeId){
  if (graph.adj && graph.allEdges) {
    const bag = graph.adj.get(nodeId) || new Set();
    const edges = graph.allEdges();
    const out = [];
    for (const eid of bag) { const e = edges.get(eid); if (e) out.push(e); }
    return out;
  }
  if (typeof graph.incidentEdges === 'function') {
    const ids = graph.incidentEdges(nodeId) || [];
    const out = [];
    const get = graph.getEdge?.bind(graph);
    for (const eid of ids) { const e = get ? get(eid) : null; if (e) out.push(e); }
    return out;
  }
  return [];
}

export const incidentEdgesOf = incidentEdgesOfObj;
