// ──────────────────────────────────────────────────────────────────────────────
// src/debug/metricTrace.js
// Konsolloggning av mental graf (node.meta.metric) + kantmått runt ett edgeId.
// ─────────────────────────────────────────────────────────────────────────────-
function coincidentGroups(graph, nodeIds, eps = 1e-6) {
  const groups = [];
  for (const nid of nodeIds) {
    const w = graph.getNodeWorldPos(nid);
    if (!w) continue;
    let g = groups.find(g =>
      Math.abs(g.w.x - w.x) < eps &&
      Math.abs(g.w.y - w.y) < eps &&
      Math.abs(g.w.z - w.z) < eps
    );
    if (!g) { g = { w, ids: [] }; groups.push(g); }
    g.ids.push(nid);
  }
  const map = new Map();
  groups.forEach((g, i) => g.ids.forEach(id => map.set(id, g.ids.length > 1 ? `G${i}` : null)));
  return map; // nid -> "G0"/"G1"/... eller null om unik
}

export function dumpComponentAroundEdge(graph, edgeId, { title = '' } = {}) {
  // Samla topologisk komponent runt given kant
  const comp = collectComponentFromEdge(graph, edgeId);
  if (!comp.nodes.length) {
    console.group(`[TRACE] ${title} (edge ${edgeId}) – no component`);
    console.groupEnd();
    return;
  }

  // Hämta metrisk lösning från kalkylatorn (tyst)
  let metricData = null;
  try {
    metricData = calculateMetricData(graph, { quiet: true });
  } catch (_) {
    metricData = null;
  }

  // Om kalkylatorn gav något, extrahera ev. härledda längder (Map)
  const derivedMap = metricData?.derivedEdgeLengths || null;

  // — Noder: world (schematiskt) + calc (metriskt)
  const nodesTbl = [];
  for (const nid of comp.nodes) {
    const n = graph.getNode(nid);

    // world (schematiskt)
    const w = graph.getNodeWorldPos(nid) || { x: NaN, y: NaN, z: NaN };

    // calc (metriskt) – hämta från kalkylatorns koordinat-Map
    const c = metricData?.get?.(nid) || null;
    const coincMap = coincidentGroups(graph, comp.nodes);
    nodesTbl.push({
      nid,
      // calc/metriskt
      'calc.x': round(c?.x), 'calc.y': round(c?.y), 'calc.z': round(c?.z),
      'calc.known': !!c, // true om placerad i metriska lösningen

      // world/schematiskt
      'world.x': round(w.x), 'world.y': round(w.y), 'world.z': round(w.z),

      // ev. tidigare metric-meta (kan vara stale, men behåll för jämförelse)
      'meta.metric.x': round(n?.meta?.metric?.x),
      'meta.metric.y': round(n?.meta?.metric?.y),
      'meta.metric.z': round(n?.meta?.metric?.z),
      'meta.metric.known': !!n?.meta?.metric?.known,
      'world.coincident': coincMap.get(nid),
    });
  }

  // — Kanter: visa både dim och faktisk metrisk längd
  const edgesTbl = [];
  for (const eid of comp.edges) {
    const e = graph.getEdge(eid);
    const dim = e?.dim || {};

    // Metrisk längd från kalkylatorn:
    let metricLen = NaN;
    if (metricData) {
      const A = metricData.get(e.a);
      const B = metricData.get(e.b);
      if (A && B) metricLen = dist3(A, B);
    }

    // Alternativt: derivedEdgeLengths om den finns (ska matcha dist3(A,B))
    const derivedLen = derivedMap?.get?.(eid);
    edgesTbl.push({
      eid, kind: e.kind, a: e.a, b: e.b,

      // från kalkylatorns faktiska koordinater
      'calc.metricLen(mm)': round(metricLen),

      // extra: derivedEdgeLengths-map (om satt)
      'calc.derivedLen(mm)': round(derivedLen),

      // användarmått
      'dim.valueMm': round(dim.valueMm),
      'dim.source': dim.source || null,
      'mode': dim.mode || null,
      'userEditedAt': dim.userEditedAt ?? null,
      'conflict?': !!dim.conflict,
    });
  }

  // — Utskrift
  console.group(`[TRACE] ${title} (edge ${edgeId})`);
  console.log('Nodes (calc metric + world + meta.metric):');
  console.table(nodesTbl);
  console.log('Edges (calc.metricLen vs dim.valueMm):');
  console.table(edgesTbl);

  // Bonus: snabb överblick om kalkylatorn inte kunde lösa allt
  if (!metricData) {
    console.warn('[TRACE] calculator returned null (graph not solvable or missing constraints)');
  } else {
    const unplaced = comp.nodes.filter(nid => !metricData.get?.(nid));
    if (unplaced.length) {
      console.warn('[TRACE] Unplaced metric nodes:', unplaced);
    }
  }

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
