// ──────────────────────────────────────────────────────────────────────────────
// src/draw/tools/split/index.js (tidigare splitEdge.js)
// ──────────────────────────────────────────────────────────────────────────────
import { solve } from '../../../measure/solverEngine.js';
import { applySolution } from '../../../measure/metricBuilder.js';

export function splitEdge(graph, edgeId, opts = {}) {
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
  function finite(n){ return (typeof n === 'number' && isFinite(n)) ? n : null; }

  // t från hitWorldPos (om ej given)
  let t = (typeof opts.t === 'number') ? opts.t : null;
  if (t == null) {
    const p = opts.hitWorldPos;
    if (!p) return { ok:false, reason:'need_hitWorldPos_or_t' };
    const ap = { x: p.x - pa.x, y: p.y - pa.y, z: p.z - pa.z };
    const dot = ap.x*ab.x + ap.y*ab.y + ap.z*ab.z;
    t = dot / abLen2;
  }

  const clampEps = (typeof opts.clampEps === 'number') ? opts.clampEps : 1e-6;
  const tClamped = Math.max(0, Math.min(1, t));
  if (tClamped <= clampEps)  return { ok:false, reason:'too_close_to_a', snapTo:e.a, t:0 };
  if (tClamped >= 1-clampEps) return { ok:false, reason:'too_close_to_b', snapTo:e.b, t:1 };

  const pSplit = lerp(pa, pb, tClamped);

  // 1) Ny nod
  const nNew = graph.addNodeAt(pSplit);
  const newNodeId = nNew.id;
  opts.onNodeCreated?.(newNodeId);

  // Bevara spec + dim-mode
  const spec    = graph.getEdgeSpec(edgeId);
  const oldDim  = graph.getEdgeDimension(edgeId);
  const dimMode = oldDim?.mode || 'aligned';

  // Kedje-id
  const oldMeta    = graph.getEdgeMeta(edgeId) || {};
  const oldChainId = oldMeta?.chain?.id ?? null;
  const chainId =
    oldChainId ||
    (typeof opts.chainIdFactory === 'function' ? (opts.chainIdFactory(e) || null) : null) ||
    e.id;

  // Ev totalMm
  const totalMm = finite(oldDim?.valueMm);

  // 2) Ta bort original
  graph.removeEdge(edgeId);
  opts.onEdgeRemoved?.(edgeId);

  // 3) Två nya kanter
  const left  = graph.addEdge(e.a, newNodeId, e.kind);
  const right = graph.addEdge(newNodeId, e.b, e.kind);
  if (spec) {
    graph.setEdgeSpec(left.id,  spec);
    graph.setEdgeSpec(right.id, spec);
  }

  // 4) Kedjemeta – **stämpla ändnoderna från originalet**
  const chainMeta = (id)=>({
    chain: {
      id,
      totalMm: totalMm ?? null,
      distribution: 'even',
      createdAt: Date.now(),
      endA: e.a,          // <── DETTA ÄR NYTT
      endB: e.b           // <── DETTA ÄR NYTT
    },
    splitParentId: e.id
  });
  graph.setEdgeMeta(left.id,  chainMeta(chainId));
  graph.setEdgeMeta(right.id, chainMeta(chainId));

  // 5) Nollställ segment-dim → solver fördelar
  const derivedFrom = { type:'split', parentEdgeId: e.id, chainId };
  graph.setEdgeDimension(left.id,  { valueMm: null, mode: dimMode, source:'derived', derivedFrom }, { silent:true });
  graph.setEdgeDimension(right.id, { valueMm: null, mode: dimMode, source:'derived', derivedFrom }, { silent:true });

  opts.onEdgeAdded?.(left.id);
  opts.onEdgeAdded?.(right.id);

  // 6) Klassificera topo
  graph.classifyAndStoreMany([ e.a, newNodeId, e.b ]);

  // 7) Räkna + applicera direkt
  const solution = solve(graph, left.id);
  applySolution(graph, solution, { silent: false });

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
