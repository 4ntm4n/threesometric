// ──────────────────────────────────────────────────────────────────────────────
// src/calculation/stateManager.js
// State Manager: avgör om grafen är lösbar (enligt CONTRACT.md)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Offentligt API
 *  - checkGraphSolvable(graph) : { ok:boolean, reason?:string, details?:any }
 *  - isGraphSolvable(graph)    : boolean
 *
 * Reason-koder (ur CONTRACT.md):
 *  - 'anchor_count'
 *  - 'no_absolute_reference'
 *  - 'insufficient_constraints_at_node'
 *  - 'disconnected_subgraph'
 *  - 'ambiguous_location'
 *  - 'dimension_missing'
 */

export function checkGraphSolvable(graph) {
  const nodes = graph.allNodes();
  const edges = graph.allEdges();

  // 1. Anchor check
  const anchors = [...nodes.values()].filter(n => n?.meta?.isAnchor);
  if (anchors.length !== 1) {
    return { ok: false, reason: 'anchor_count', details: { count: anchors.length } };
  }

  // 2. Absolut referens (axisLock eller liknande)
  const hasAbsolute = [...edges.values()].some(e => e?.meta?.axisLock);
  if (!hasAbsolute) {
    return { ok: false, reason: 'no_absolute_reference' };
  }

  // 3. Traverseringskontroll (enkelt: kolla att alla noder är nåbara)
  const visited = new Set();
  function dfs(nid) {
    if (visited.has(nid)) return;
    visited.add(nid);
    for (const { otherId } of graph.neighbors(nid)) {
      dfs(otherId);
    }
  }
  dfs(anchors[0].id);
  if (visited.size !== nodes.size) {
    return { ok: false, reason: 'disconnected_subgraph' };
  }

  // 4. Kontrollera att mått finns där de behövs
  for (const e of edges.values()) {
    if (!e.dim || typeof e.dim.valueMm !== 'number' || !(e.dim.valueMm > 0)) {
      return { ok: false, reason: 'dimension_missing', details: { edgeId: e.id } };
    }
  }

  // 5. Konsistenskontroll av trianglar
  // För varje triplet av noder som bildar en triangel (alla tre kanter finns och har mått):
  const edgeMap = new Map();
  for (const e of edges.values()) {
    edgeMap.set([e.a, e.b].sort().join('-'), e);
  }

  for (const n1 of nodes.keys()) {
    for (const n2 of nodes.keys()) {
      if (n2 <= n1) continue;
      for (const n3 of nodes.keys()) {
        if (n3 <= n2) continue;

        const e12 = edgeMap.get([n1,n2].sort().join('-'));
        const e23 = edgeMap.get([n2,n3].sort().join('-'));
        const e13 = edgeMap.get([n1,n3].sort().join('-'));
        if (!e12 || !e23 || !e13) continue;

        const a = e12.dim?.valueMm;
        const b = e23.dim?.valueMm;
        const c = e13.dim?.valueMm;
        if (!(a && b && c)) continue;

        // Triangelolikheten: summan av två sidor > tredje
        if (a + b <= c + 1e-6 || a + c <= b + 1e-6 || b + c <= a + 1e-6) {
          return {
            ok: false,
            reason: 'dimension_conflict',
            details: { nodes: [n1,n2,n3], edges: [e12.id, e23.id, e13.id] }
          };
        }
      }
    }
  }

  // Om allt gick bra
  return { ok: true };
}

export function isGraphSolvable(graph) {
  return checkGraphSolvable(graph).ok;
}

// ──────────────────────────────────────────────────────────────────────────────
// Hjälpare (privata)
// ──────────────────────────────────────────────────────────────────────────────

function incidentEdgesOf(graph, nodeId) {
  // Preferera snabbväg via adj, annars neighbors()
  if (graph.adj && graph.allEdges) {
    const bag = graph.adj.get(nodeId) || new Set();
    const edges = graph.allEdges();
    const out = [];
    for (const eid of bag) {
      const e = edges.get(eid);
      if (e) out.push(e);
    }
    return out;
  }
  // fallback
  return graph.incidentEdges?.(nodeId) || [];
}

function otherOf(e, nid) {
  return (e.a === nid) ? e.b : e.a;
}

function bfsReachableNodeIds(graph, startId) {
  const visited = new Set();
  const q = [startId];
  visited.add(startId);

  while (q.length) {
    const nid = q.shift();
    const inc = incidentEdgesOf(graph, nid);
    for (const e of inc) {
      // Båda center och construction får binda topologi
      const other = otherOf(e, nid);
      if (!visited.has(other)) {
        visited.add(other);
        q.push(other);
      }
    }
  }
  return [...visited];
}
