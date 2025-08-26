// ──────────────────────────────────────────────────────────────────────────────
// src/model/graph.js
// Supertunn graf: nodes/edges + adjacency + auto-id + "getOrCreateNodeAt"
// ──────────────────────────────────────────────────────────────────────────────
export function createGraph() {
  const nodes = new Map(); // id -> { id, base:{x,y,z}, offset:{x,y,z} }
  const edges = new Map(); // id -> { id, a, b, kind:'center'|'construction' }
  const adj   = new Map(); // nodeId -> Set(edgeId)

  let nodeSeq = 1;
  let edgeSeq = 1;

  function _newNodeId() { return `n${nodeSeq++}`; }
  function _newEdgeId() { return `e${edgeSeq++}`; }

  function _ensureAdj(nid) {
    if (!adj.has(nid)) adj.set(nid, new Set());
  }

  function addNodeAt(pos) {
    const id = _newNodeId();
    const n = { id, base:{ x:pos.x, y:pos.y, z:pos.z }, offset:{ x:0, y:0, z:0 } };
    nodes.set(id, n);
    _ensureAdj(id);
    return n;
  }

  function getNode(id) { return nodes.get(id); }
  function getEdge(id) { return edges.get(id); }

  function allNodes() { return nodes; }
  function allEdges() { return edges; }

  // hitta existerande nod inom tolerans (världsenheter)
  function findNodeNear(pos, tol=1e-4) {
    let best = null, bestD2 = tol*tol;
    for (const n of nodes.values()) {
      const dx = n.base.x - pos.x, dy = n.base.y - pos.y, dz = n.base.z - pos.z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 <= bestD2) { bestD2 = d2; best = n; }
    }
    return best;
  }

  function getOrCreateNodeAt(pos, tol=1e-4) {
    const hit = findNodeNear(pos, tol);
    if (hit) return { node: hit, created: false };
    const n = addNodeAt(pos);
    return { node: n, created: true };
  }

  function addEdge(aId, bId, kind='center') {
    if (aId === bId) return null; // ignorera noll-längd
    const id = _newEdgeId();
    const e = { id, a:aId, b:bId, kind };
    edges.set(id, e);
    _ensureAdj(aId); _ensureAdj(bId);
    adj.get(aId).add(id);
    adj.get(bId).add(id);
    return e;
  }

  return {
    nodes, edges, adj,
    addNodeAt, getOrCreateNodeAt, addEdge,
    getNode, getEdge, allNodes, allEdges
  };
}
