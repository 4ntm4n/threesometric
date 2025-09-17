// ─────────────────────────────────────────────
// src/debug/graphTrace.js
// Loggar nodpositioner (schematiska) + kantmått/constraints
// ─────────────────────────────────────────────
export function createGraphTracer(graph, { label = 'GraphTrace' } = {}) {
  function snapshot(reason = '') {
    const nodes = [];
    for (const n of graph.allNodes().values()) {
      const p = graph.getNodeWorldPos(n.id) || {x:0,y:0,z:0};
      nodes.push({
        id: n.id,
        pos: { x:+p.x.toFixed(3), y:+p.y.toFixed(3), z:+p.z.toFixed(3) },
        anchor: !!n.meta?.isAnchor,
        topo: n.meta?.topo || null
      });
    }

    const edges = [];
    for (const e of graph.allEdges().values()) {
      edges.push({
        id: e.id, kind: e.kind, a: e.a, b: e.b,
        dim: e.dim?.valueMm ?? null,
        mode: e.dim?.mode ?? null,
        meta: compactMeta(e.meta)
      });
    }

    console.groupCollapsed(`[${label}] ${reason}`);
    console.table(nodes);
    console.table(edges);
    console.groupEnd();
  }

  function compactMeta(m) {
    if (!m) return null;
    const out = {};
    if (m.axisLock) out.axisLock = m.axisLock;
    if (m.parallelTo?.ref) out.parallelTo = { ref: m.parallelTo.ref };
    if (m.perpTo?.ref) out.perpTo = { ref: m.perpTo.ref };
    if (m.angleTo?.ref != null) out.angleTo = { ref: m.angleTo.ref, deg: m.angleTo.deg };
    if (m.coplanarWith) out.coplanarWith = summarizePlaneRef(m.coplanarWith);
    return Object.keys(out).length ? out : null;
  }

  function summarizePlaneRef(pr){
    if (!pr) return null;
    if (pr.type === 'byEdges')  return { type:'byEdges',  refs: pr.refs };
    if (pr.type === 'byEdgeUp') return { type:'byEdgeUp', ref: pr.ref, up: pr.up || 'globalUp' };
    if (pr.type === 'byNormal') return { type:'byNormal', n: round3(pr.n) };
    return { ...pr };
  }

  function round3(v){
    if (!v) return v;
    return { x:+(v.x??0).toFixed(3), y:+(v.y??0).toFixed(3), z:+(v.z??0).toFixed(3) };
  }

  return { snapshot };
}
