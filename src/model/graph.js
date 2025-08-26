// ──────────────────────────────────────────────────────────────────────────────
// src/model/graph.js
// Supertunn graf: nodes/edges + adjacency + auto-id + getOrCreateNodeAt
// + helpers som slope.js behöver (getNodeWorldPos, setNodeWorldY, neighbors)
// ──────────────────────────────────────────────────────────────────────────────

export function createGraph() {
  const nodes = new Map(); // id -> { id, base:{x,y,z}, offset:{x,y,z} }
  const edges = new Map(); // id -> { id, a, b, kind:'center'|'construction' }
  const adj   = new Map(); // nodeId -> Set(edgeId)

  let nodeSeq = 1;
  let edgeSeq = 1;

  function _newNodeId() { return `n${nodeSeq++}`; }
  function _newEdgeId() { return `e${edgeSeq++}`; }
  function _ensureAdj(nid) { if (!adj.has(nid)) adj.set(nid, new Set()); }

  // ---- Nodes
  function addNodeAt(pos) {
    const id = _newNodeId();
    const n = {
      id,
      base:   { x: pos.x, y: pos.y, z: pos.z },
      offset: { x: 0,     y: 0,     z: 0     },
    };
    nodes.set(id, n);
    _ensureAdj(id);
    return n;
  }

  function getNode(id) { return nodes.get(id); }
  function allNodes() { return nodes; }

  // world-pos = base + offset
  function getNodeWorldPos(id) {
    const n = nodes.get(id);
    if (!n) return null;
    const b = n.base ?? { x:0,y:0,z:0 };
    const o = n.offset ?? { x:0,y:0,z:0 };
    return { x: (b.x||0)+(o.x||0), y: (b.y||0)+(o.y||0), z: (b.z||0)+(o.z||0) };
  }

  // sätt world-Y (ändra endast offset.y)
  function setNodeWorldY(id, yNew) {
    const n = nodes.get(id);
    if (!n) return;
    if (!n.base)   n.base   = { x:0,y:0,z:0 };
    if (!n.offset) n.offset = { x:0,y:0,z:0 };
    const curY = (n.base.y||0) + (n.offset.y||0);
    n.offset.y = (n.offset.y||0) + (yNew - curY);
  }

  // hitta existerande nod inom tolerans (världsenheter)
  function findNodeNear(pos, tol=1e-4) {
    let best = null, bestD2 = tol*tol;
    for (const n of nodes.values()) {
      const b = n.base ?? {x:0,y:0,z:0};
      const o = n.offset ?? {x:0,y:0,z:0};
      const nx = (b.x||0)+(o.x||0);
      const ny = (b.y||0)+(o.y||0);
      const nz = (b.z||0)+(o.z||0);
      const dx = nx - pos.x, dy = ny - pos.y, dz = nz - pos.z;
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

  // ---- Edges
  function addEdge(aId, bId, kind='center') {
    if (aId === bId) return null; // ignorera noll-längd
    const id = _newEdgeId();
    const e = { id, a: aId, b: bId, kind };
    edges.set(id, e);
    _ensureAdj(aId); _ensureAdj(bId);
    adj.get(aId).add(id);
    adj.get(bId).add(id);
    return e;
  }

  function getEdge(id) { return edges.get(id); }
  function allEdges() { return edges; }

  // Grannar runt en nod, valfritt filter på kind ('center'|'construction')
  function neighbors(nodeId, { kind = null } = {}) {
    const out = [];
    const bag = adj.get(nodeId);
    if (!bag) return out;
    for (const eid of bag) {
      const e = edges.get(eid);
      if (!e) continue;
      if (kind && e.kind !== kind) continue;
      const otherId = (e.a === nodeId) ? e.b : e.a;
      out.push({ edge: e, otherId });
    }
    return out;
  }

  return {
    // data
    nodes, edges, adj,
    // node API
    addNodeAt, getOrCreateNodeAt, getNode, allNodes,
    getNodeWorldPos, setNodeWorldY, findNodeNear,
    // edge API
    addEdge, getEdge, allEdges, neighbors,
  };
}
