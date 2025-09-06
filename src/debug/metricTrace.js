// ──────────────────────────────────────────────────────────────────────────────
// src/debug/metricTrace.js
// Konsolloggning av mental graf (node.meta.metric) + kantmått runt ett edgeId.
// ─────────────────────────────────────────────────────────────────────────────-
export function dumpComponentAroundEdge(graph, edgeId, { title = '' } = {}) {
  const comp = collectComponentFromEdge(graph, edgeId);
  if (!comp.nodes.length) {
    console.group(`[TRACE] ${title} (edge ${edgeId}) – no component`);
    console.groupEnd();
    return;
  }
  const nodesTbl = [];
  for (const nid of comp.nodes) {
    const n = graph.getNode(nid);
    const m = n?.meta?.metric || {};
    const w = graph.getNodeWorldPos(nid) || { x:NaN, y:NaN, z:NaN };
    nodesTbl.push({
      nid,
      'metric.x': round(m.x), 'metric.y': round(m.y), 'metric.z': round(m.z), known: !!m.known,
      'world.x': round(w.x),  'world.y': round(w.y),  'world.z': round(w.z),
    });
  }

  const edgesTbl = [];
  for (const eid of comp.edges) {
    const e   = graph.getEdge(eid);
    const aM  = graph.getNode(e.a)?.meta?.metric;
    const bM  = graph.getNode(e.b)?.meta?.metric;
    const dMm = (aM?.known && bM?.known) ? dist3(aM,bM) : NaN;
    const dim = e.dim || {};
    edgesTbl.push({
      eid, kind: e.kind, a: e.a, b: e.b,
      'metricLen(mm)': round(dMm),
      'dim.valueMm': round(dim.valueMm),
      'dim.source': dim.source || null,
      'userEditedAt': dim.userEditedAt ?? null,
      'conflict?': !!dim.conflict,
    });
  }

  console.group(`[TRACE] ${title} (edge ${edgeId})`);
  console.log('Nodes (metric + world):');
  console.table(nodesTbl);
  console.log('Edges (metric length vs dim):');
  console.table(edgesTbl);
  console.groupEnd();
}

export function dumpPathAndRecency(graph, path, recList, { title = '' } = {}) {
  const tblPath = [];
  for (let i=0;i<path.edges.length;i++){
    const eid = path.edges[i];
    const e   = graph.getEdge(eid);
    tblPath.push({
      i,
      eid,
      kind: e.kind,
      a: path.nodes[i],
      b: path.nodes[i+1],
      axis: dominantAxis(vecW(graph, path.nodes[i], path.nodes[i+1])),
      sign: Math.sign(vecW(graph, path.nodes[i], path.nodes[i+1])[ dominantAxis(vecW(graph, path.nodes[i], path.nodes[i+1])).toLowerCase() ]) || 1
    });
  }
  const tblRec = recList.map(r => ({ type:r.type, eid:r.eid, stamp:r.stamp }));
  console.group(`[TRACE] ${title}`);
  console.log('Manhattan path:');
  console.table(tblPath);
  console.log('Recency (sorted desc by stamp):');
  console.table(tblRec);
  console.groupEnd();
}

// — helpers —
function collectComponentFromEdge(graph, startEid) {
  const e0 = graph.getEdge(startEid); if (!e0) return { nodes:[], edges:[] };
  const seenN = new Set(), seenE = new Set(); const q = [];
  seenN.add(e0.a); seenN.add(e0.b); q.push(e0.a, e0.b); seenE.add(startEid);
  while (q.length) {
    const nid = q.shift();
    const bag = graph.incidentEdges(nid, {});
    for (const e of bag) {
      if (!seenE.has(e.id)) seenE.add(e.id);
      const other = (e.a === nid) ? e.b : e.a;
      if (!seenN.has(other)) { seenN.add(other); q.push(other); }
    }
  }
  return { nodes:[...seenN], edges:[...seenE] };
}
function vecW(graph, aId, bId){
  const aW = graph.getNodeWorldPos(aId), bW = graph.getNodeWorldPos(bId);
  return { x:bW.x-aW.x, y:bW.y-aW.y, z:bW.z-aW.z };
}
function dominantAxis(d){
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return 'X';
  if (az >= ax && az >= ay) return 'Z';
  return 'Y';
}
function dist3(a,b){ return Math.hypot((b.x||0)-(a.x||0),(b.y||0)-(a.y||0),(b.z||0)-(a.z||0)); }
function round(v){ return (typeof v==='number' && isFinite(v)) ? Math.round(v*100)/100 : v; }
