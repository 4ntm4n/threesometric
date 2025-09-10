// ──────────────────────────────────────────────────────────────────────────────
// src/draw/tools/split/index.js tidigare split(splitEdge.js)
// Delar en center-edge vid world-koord (eller param t) och skapar en "kedja"
// ──────────────────────────────────────────────────────────────────────────────

export function splitEdge(graph, edgeId, opts = {}) {
  // opts:
  //   hitWorldPos?: {x,y,z}   // alternativt
  //   t?: number               // [0..1], om du redan projicerat
  //   clampEps?: number        // minsta avstånd från ändar
  //   enforceCenterOnly?: bool // default true
  //   onEdgeRemoved?: (edgeId)=>void
  //   onEdgeAdded?: (edgeId)=>void
  //   onNodeCreated?: (nodeId)=>void
  //   chainIdFactory?: (oldEdge)=>string
  //
  // return:
  //   { ok, reason?, newNodeId?, leftEdgeId?, rightEdgeId?, removedEdgeId?, chainId?, t, pos }

  const e = graph.getEdge(edgeId);
  if (!e) return { ok:false, reason:'no_edge' };

  const enforceCenterOnly = opts.enforceCenterOnly !== false;
  if (enforceCenterOnly && e.kind !== 'center') {
    return { ok:false, reason:'only_center_edges_can_be_split' };
  }

  const pa = graph.getNodeWorldPos(e.a);
  const pb = graph.getNodeWorldPos(e.b);
  if (!pa || !pb) return { ok:false, reason:'nodes_without_world_pos' };

  const ab = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
  const abLen2 = ab.x*ab.x + ab.y*ab.y + ab.z*ab.z;
  if (abLen2 <= 1e-12) return { ok:false, reason:'degenerate_edge' };

  function lerp(a,b,t){ return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t }; }

  let t = typeof opts.t === 'number' ? opts.t : null;
  if (t == null) {
    const p = opts.hitWorldPos;
    if (!p) return { ok:false, reason:'need_hitWorldPos_or_t' };
    const ap = { x: p.x - pa.x, y: p.y - pa.y, z: p.z - pa.z };
    const dot = ap.x*ab.x + ap.y*ab.y + ap.z*ab.z;
    t = dot / abLen2; // projektion på segmentet (oklamped)
  }

  // Klampa och undvik 0/1
  const clampEps = (typeof opts.clampEps === 'number') ? opts.clampEps : 1e-6;
  const tClamped = Math.max(0, Math.min(1, t));
  if (tClamped <= clampEps) {
    return { ok:false, reason:'too_close_to_a', snapTo:e.a, t:0 };
  }
  if (tClamped >= 1 - clampEps) {
    return { ok:false, reason:'too_close_to_b', snapTo:e.b, t:1 };
  }

  const pSplit = lerp(pa, pb, tClamped);

  // 1) Skapa ny nod i grafen (single source of truth)
  const nNew = graph.addNodeAt(pSplit);
  const newNodeId = nNew.id;
  if (typeof opts.onNodeCreated === 'function') opts.onNodeCreated(newNodeId);

  // Bevara ev. spec från originalkanten
  const spec = graph.getEdgeSpec(edgeId);

  // Dim-mode från original om den fanns (t.ex. 'aligned')
  const oldDim = graph.getEdgeDimension(edgeId);
  const dimMode = oldDim?.mode || 'aligned';

  // Kedje-id: använd befintligt chainId om det finns, annars original edgeId
  const oldMeta = graph.getEdgeMeta(edgeId) || {};
  const chainId = (typeof opts.chainIdFactory === 'function')
    ? (opts.chainIdFactory(e) || (oldMeta.chainId || e.id))
    : (oldMeta.chainId || e.id);

  // 2) Ta bort originalkanten
  graph.removeEdge(edgeId);
  if (typeof opts.onEdgeRemoved === 'function') opts.onEdgeRemoved(edgeId);

  // 3) Skapa två nya kanter
  const left   = graph.addEdge(e.a, newNodeId, e.kind);
  const right  = graph.addEdge(newNodeId, e.b, e.kind);

  // Kopiera spec
  if (spec) {
    graph.setEdgeSpec(left.id,  spec);
    graph.setEdgeSpec(right.id, spec);
  }

  // Kedje-meta (platt kedja)
  graph.setEdgeMeta(left.id,  { chainId, splitParentId: e.id });
  graph.setEdgeMeta(right.id, { chainId, splitParentId: e.id });

  // Dim: nollställ per-segment som "derived/chain" (autosolver tar totalen sen)
  graph.setEdgeDimension(left.id,  { valueMm: null, mode: dimMode, source:'derived', derivedFrom:{ type:'split', parentEdgeId: e.id, chainId } }, { silent:true });
  graph.setEdgeDimension(right.id, { valueMm: null, mode: dimMode, source:'derived', derivedFrom:{ type:'split', parentEdgeId: e.id, chainId } }, { silent:true });

  if (typeof opts.onEdgeAdded === 'function') {
    opts.onEdgeAdded(left.id);
    opts.onEdgeAdded(right.id);
  }

  // Klassificera lokalt (för overlay/debug)
  graph.classifyAndStoreMany([ e.a, newNodeId, e.b ]);

  // Ge tillbaka en enkel payload till UI/solver/picking
  return {
    ok: true,
    newNodeId,
    leftEdgeId:  left.id,
    rightEdgeId: right.id,
    removedEdgeId: edgeId,
    chainId,
    t: tClamped,
    pos: pSplit,
  };
}
