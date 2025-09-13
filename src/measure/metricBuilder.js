// ──────────────────────────────────────────────────────────────────────────────
// src/measure/metricBuilder.js
// "Byggaren": applicerar en solution på grafen (meta.metric + edge.dim)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ x:number, y:number, z:number, known?:boolean }} MetricPos
 * @typedef {{ nodes: Map<string, MetricPos>, edges: Map<string, any> }} Solution
 */

export function applySolution(graph, solution, opts = {}) {
  if (!solution) return graph;
  const silent = !!opts.silent;

  // 1) Noder
  if (solution.nodes && typeof solution.nodes.forEach === 'function') {
    solution.nodes.forEach((pos, nid) => {
      const n = graph.getNode(nid);
      if (!n) return;
      n.meta = n.meta || {};
      n.meta.metric = {
        x: Number(pos?.x) || 0,
        y: Number(pos?.y) || 0,
        z: Number(pos?.z) || 0,
        known: !!pos?.known
      };
    });
  }

  // 2) Kanter (dimensioner)
  if (solution.edges && typeof solution.edges.forEach === 'function') {
    solution.edges.forEach((dim, eid) => {
      if (!eid) return;
      const safe = dim ? { ...dim } : {};
      graph.setEdgeDimension(eid, safe, { silent });
    });
  }

  return graph;
}
