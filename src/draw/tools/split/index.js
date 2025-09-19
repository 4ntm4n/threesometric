// ──────────────────────────────────────────────────────────────────────────────
// src/draw/tools/split/index.js
// Delar en center-edge vid world-koord (eller param t) och skapar en "kedja"
// ──────────────────────────────────────────────────────────────────────────────

export function splitEdge(graph, edgeId, opts = {}) {
  // opts:
  //   hitWorldPos?: {x,y,z}
  //   t?: number            // [0..1], om du redan projicerat
  //   clampEps?: number
  //   enforceCenterOnly?: bool  // default true
  //   onEdgeRemoved?: (edgeId)=>void
  //   onEdgeAdded?: (edgeId)=>void
  //   onNodeCreated?: (nodeId)=>void
  //   chainIdFactory?: (oldEdge)=>string
  //   mergeEps?: number
  //
  // return:
  //   { ok, reason?, newNodeId?, leftEdgeId?, rightEdgeId?, removedEdgeId?, chainId?, t, pos }

  const e = graph.getEdge(edgeId);
  if (!e) return { ok: false, reason: 'no_edge' };

  const enforceCenterOnly = opts.enforceCenterOnly !== false;
  if (enforceCenterOnly && e.kind !== 'center') {
    return { ok: false, reason: 'only_center_edges_can_be_split' };
  }

  // Försök hämta ändpunkter (kan saknas innan metrisk placering)
  const pa = graph.getNodeWorldPos?.(e.a) || graph.getNodeBasePos?.(e.a) || null;
  const pb = graph.getNodeWorldPos?.(e.b) || graph.getNodeBasePos?.(e.b) || null;

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

  let t = (typeof opts.t === 'number') ? opts.t : null;
  let tClamped = null;
  let pSplit = null;

  if (pa && pb) {
    // Projektera på AB
    const ab = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
    const abLen2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    if (abLen2 <= 1e-12) return { ok: false, reason: 'degenerate_edge' };

    if (t == null) {
      const p = opts.hitWorldPos;
      if (!p) return { ok: false, reason: 'need_hitWorldPos_or_t' };
      const ap = { x: p.x - pa.x, y: p.y - pa.y, z: p.z - pa.z };
      const dot = ap.x * ab.x + ap.y * ab.y + ap.z * ab.z;
      t = dot / abLen2; // oklampad projektion
    }

    const clampEps = (typeof opts.clampEps === 'number') ? opts.clampEps : 1e-6;
    tClamped = Math.max(0, Math.min(1, t));
    if (tClamped <= clampEps)   return { ok: false, reason: 'too_close_to_a', snapTo: e.a, t: 0 };
    if (tClamped >= 1 - clampEps) return { ok: false, reason: 'too_close_to_b', snapTo: e.b, t: 1 };

    pSplit = lerp(pa, pb, tClamped);
  } else {
    // FALLBACK: saknar world-coords för A/B → använd klickpunkten direkt
    if (!opts.hitWorldPos) return { ok: false, reason: 'need_hitWorldPos_when_no_world_endpoints' };
    pSplit = { x: opts.hitWorldPos.x, y: opts.hitWorldPos.y, z: opts.hitWorldPos.z };
    tClamped = null; // kan inte beräkna t utan world-coords
  }

  // 1) Skapa eller återanvänd nod vid splitpunkten (undvik dubletter)
  const mergeEps = (typeof opts.mergeEps === 'number') ? opts.mergeEps : 1e-6;
  let existing = null;
  if (typeof graph.findNodeNear === 'function') {
    existing = graph.findNodeNear(pSplit, mergeEps);
    if (existing && (existing.id === e.a || existing.id === e.b)) existing = null;
  }

  let newNodeId;
  if (existing) {
    newNodeId = existing.id;
  } else {
    const nNew = graph.addNodeAt(pSplit);
    newNodeId = nNew.id;
    if (typeof opts.onNodeCreated === 'function') opts.onNodeCreated(newNodeId);
  }

  // Sätt/behåll onSegment på T-noden (utan att skriva över annan meta)
  try {
    const prevMeta = graph.getNode?.(newNodeId)?.meta || {};
    if (!prevMeta.onSegment) {
      const nextMeta = { ...prevMeta, onSegment: { a: e.a, b: e.b } };
      if (typeof graph.setNodeMeta === 'function') graph.setNodeMeta(newNodeId, nextMeta);
      else { const n = graph.getNode?.(newNodeId); if (n) n.meta = nextMeta; }
    }
  } catch { /* ignore */ }

  // Bevara spec och dim-mode från original
  const spec   = graph.getEdgeSpec?.(edgeId);
  const oldDim = graph.getEdgeDimension?.(edgeId);
  const dimMode = (oldDim?.mode ?? e.dim?.mode ?? 'aligned');

  // ── plocka constraints från originalet (innan removeEdge) ───────────────────
  const pickConstraintMeta = (m = {}) => {
    const out = {};
    if (m.axisLock)      out.axisLock = m.axisLock;                 // 'X' | 'Y' | 'Z'
    if (m.parallelTo)    out.parallelTo = { ...m.parallelTo };      // { ref }
    if (m.perpTo)        out.perpTo     = { ...m.perpTo };          // { ref }
    if (m.angleTo)       out.angleTo    = { ...m.angleTo };         // { ref, deg }
    if (m.coplanarWith)  out.coplanarWith = { ...m.coplanarWith };  // { normal|n: {x,y,z}, ... }
    return out;
  };

  const srcMeta     = (typeof graph.getEdgeMeta === 'function') ? (graph.getEdgeMeta(edgeId) || {}) : (e.meta || {});
  let   constraints = pickConstraintMeta(srcMeta);

  // Fallback: om originalet saknar alla constraints → syntetisera axisLock från world-riktningen
  if (!constraints.axisLock && !constraints.parallelTo && !constraints.perpTo && !constraints.angleTo && !constraints.coplanarWith) {
    if (pa && pb) {
      const ab = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
      const ax = Math.abs(ab.x), ay = Math.abs(ab.y), az = Math.abs(ab.z);
      constraints.axisLock = (ay >= ax && ay >= az) ? 'Y' : (az >= ax && az >= ay) ? 'Z' : 'X';
      // console.debug('[Split] synth axisLock', constraints.axisLock, 'for', edgeId);
    }
  }

  // Kedje-id
  const oldMeta = graph.getEdgeMeta?.(edgeId) || {};
  const chainId = (typeof opts.chainIdFactory === 'function')
    ? (opts.chainIdFactory(e) || (oldMeta.chainId || e.id))
    : (oldMeta.chainId || e.id);

  // 2) Ta bort originalkanten
  graph.removeEdge(edgeId);
  if (typeof opts.onEdgeRemoved === 'function') opts.onEdgeRemoved(edgeId);

  // 3) Skapa två nya kanter (växer utåt från split-noden)
  const left  = graph.addEdge(e.a, newNodeId, e.kind);
  const right = graph.addEdge(newNodeId, e.b, e.kind);

  // Kopiera spec
  if (spec) {
    graph.setEdgeSpec?.(left.id,  spec);
    graph.setEdgeSpec?.(right.id, spec);
  }

  // ── constraints per halva ───────────────────────────────────────────────────
  let constraintsLeft  = { ...constraints };
  let constraintsRight = { ...constraints };

  const hadDirectional = !!(constraints.parallelTo || constraints.perpTo || constraints.angleTo);

  // Om originalet var "riktande" (angleTo/perpTo/parallelTo) men inte axisLock,
  // låt onSegment styra och gör halvorna kolinära i samma plan.
  if (!constraints.axisLock && hadDirectional) {
    const planeOnly = constraints.coplanarWith ? { coplanarWith: { ...constraints.coplanarWith } } : {};
    constraintsLeft  = { ...planeOnly };
    constraintsRight = { ...planeOnly, parallelTo: { ref: left.id } };
  }

  // skriv meta (constraints per halva + kedje-meta)
  const chainMeta = { chainId, splitParentId: e.id };
  if (typeof graph.setEdgeMeta === 'function') {
    graph.setEdgeMeta(left.id,  { ...constraintsLeft,  ...chainMeta });
    graph.setEdgeMeta(right.id, { ...constraintsRight, ...chainMeta });
  }

  // dimensioner: låt autosolver härleda (user sätter ev. en av dem senare)
  graph.setEdgeDimension?.(
    left.id,
    { valueMm: null, mode: dimMode, source: 'derived', derivedFrom: { type: 'split', parentEdgeId: e.id, chainId } },
    { silent: true }
  );
  graph.setEdgeDimension?.(
    right.id,
    { valueMm: null, mode: dimMode, source: 'derived', derivedFrom: { type: 'split', parentEdgeId: e.id, chainId } },
    { silent: true }
  );

  if (typeof opts.onEdgeAdded === 'function') {
    opts.onEdgeAdded(left.id);
    opts.onEdgeAdded(right.id);
  }

  // Klassificera lokalt (för overlay/debug)
  graph.classifyAndStoreMany?.([ e.a, newNodeId, e.b ]);

  // Payload
  return {
    ok: true,
    newNodeId,
    leftEdgeId:  left.id,
    rightEdgeId: right.id,
    removedEdgeId: edgeId,
    chainId,
    t: tClamped,   // kan vara null i fallback
    pos: pSplit,
  };
}
