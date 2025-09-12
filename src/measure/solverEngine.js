// ──────────────────────────────────────────────────────────────────────────────
// src/measure/solverEngine.js  — "Hjärnan" (policy + matte), state-free
// Tar in: graph, setEdgeDimension(eid, dim, opts), opts{ dumpComponentAroundEdge?, dumpPathAndRecency? }
// ──────────────────────────────────────────────────────────────────────────────

const TOL = 0.1; // mm

// Publika API-funktioner
export function recomputeComponentFromScratch(graph, edgeId, setEdgeDimension, opts = {}) {
  const e0 = graph.getEdge(edgeId); if (!e0) return;

  const { nodes: compNodes, edges: compEdges } = collectComponentFromEdge(graph, edgeId);
  if (!compNodes.length) return;

  // Nolla metric
  for (const nid of compNodes) {
    const n = graph.getNode(nid);
    n.meta = n.meta || {};
    n.meta.metric = { x:0, y:0, z:0, known:false };
  }

  // Seed: origo om möjligt (annars första noden)
  const originId = findWorldOriginNode(graph, compNodes) ?? compNodes[0];
  graph.getNode(originId).meta.metric = { x:0, y:0, z:0, known:true };

  const allEdges = compEdges.map(eid => graph.getEdge(eid)).filter(Boolean);

  // Fas 1: propagation
  let changed = true, guard = 0;
  while (changed && guard < 3 * allEdges.length + 10) {
    changed = false; guard++;

    // A) construction (axelrät)
    for (const ed of allEdges) {
      if (ed.kind !== 'construction') continue;
      const val = validNumber(ed?.dim?.valueMm); if (val == null) continue;

      const a = graph.getNode(ed.a), b = graph.getNode(ed.b);
      const mA = a.meta.metric, mB = b.meta.metric;
      const dir = edgeUnitDirWorld(graph, ed);
      if (mA.known && !mB.known) {
        b.meta.metric = { x:mA.x+dir.x*val, y:mA.y+dir.y*val, z:mA.z+dir.z*val, known:true };
        changed = true;
      } else if (!mA.known && mB.known) {
        a.meta.metric = { x:mB.x-dir.x*val, y:mB.y-dir.y*val, z:mB.z-dir.z*val, known:true };
        changed = true;
      }
    }

    // B) center (endast user, ej diagonaler)
    for (const ed of allEdges) {
      if (ed.kind !== 'center') continue;
      if ((ed.dim?.source || null) !== 'user') continue;
      if (hasConstructionPathBetween(graph, ed.a, ed.b)) continue; // diagonal? då får den inte driva

      const val = validNumber(ed?.dim?.valueMm); if (val == null) continue;

      const a = graph.getNode(ed.a), b = graph.getNode(ed.b);
      const mA = a.meta.metric, mB = b.meta.metric;
      const dir = edgeUnitDirWorld(graph, ed);
      if (mA.known && !mB.known) {
        b.meta.metric = { x:mA.x+dir.x*val, y:mA.y+dir.y*val, z:mA.z+dir.z*val, known:true };
        changed = true;
      } else if (!mA.known && mB.known) {
        a.meta.metric = { x:mB.x-dir.x*val, y:mB.y-dir.y*val, z:mB.z-dir.z*val, known:true };
        changed = true;
      }
    }
  }

  // Fas 2: derive/validera dimensioner
  for (const ed of allEdges) {
    const aM = graph.getNode(ed.a)?.meta?.metric;
    const bM = graph.getNode(ed.b)?.meta?.metric;
    if (!aM?.known || !bM?.known) continue;

    const d = dist3(aM, bM);
    const dim = ed.dim || null;
    const isUser = dim?.source === 'user';

    if (isUser) {
      const delta = Math.abs((dim?.valueMm ?? 0) - d);
      const hadConflict = !!dim?.conflict;
      if (delta > TOL && !hadConflict) {
        setEdgeDimension(ed.id, { ...dim, conflict: { deltaMm: delta } }, { silent: true });
      } else if (delta <= TOL && hadConflict) {
        setEdgeDimension(ed.id, { ...dim, conflict: null }, { silent: true });
      }
    } else {
      setEdgeDimension(ed.id, {
        valueMm: d,
        mode: dim?.mode || 'aligned',
        label: dim?.label ?? null,
        source: 'derived',
        derivedFrom: 'metric',
        conflict: null
      }, { silent: false });
    }
  }

  opts.dumpComponentAroundEdge?.(graph, edgeId, { title: 'AFTER recompute' });
}

export function normalizeLocksForDiagonal(graph, diagEid, setEdgeDimension, opts = {}) {
  const eD = graph.getEdge(diagEid); if (!eD || eD.kind !== 'center') return;
  const dimD = eD.dim || null;
  if (!dimD || dimD.source !== 'user') return;

  const path = findManhattanPath(graph, eD.a, eD.b);
  if (!path || path.edges.length === 0) return;

  const axesUsed = new Set();
  const legs = [];
  for (let i=0;i<path.edges.length;i++){
    const eid = path.edges[i];
    const ed  = graph.getEdge(eid);
    if (!ed || ed.kind !== 'construction') continue;

    const aW = graph.getNodeWorldPos(path.nodes[i]);
    const bW = graph.getNodeWorldPos(path.nodes[i+1]);
    const dW = { x:bW.x-aW.x, y:bW.y-aW.y, z:bW.z-aW.z };
    const axis = dominantAxis(dW);
    axesUsed.add(axis);

    legs.push({
      type:'leg',
      eid,
      axis,
      stamp: getUserEditedAt(ed),
      dim: ed.dim || null,
    });
  }
  const k = Math.max(1, axesUsed.size);

  const candidates = [
    { type:'diag', eid:eD.id, axis:'*', stamp:getUserEditedAt(eD), dim:dimD },
    ...legs
  ].sort((a,b)=> (b.stamp - a.stamp) || a.eid.localeCompare(b.eid));

  const keep = new Set(candidates.slice(0, k).map(c => c.eid));

  // Demota alla usersatta som inte är i "keep"
  let demotedAny = false;
  for (const c of candidates) {
    if (!keep.has(c.eid) && c.dim?.source === 'user') {
      demoteOneEdge(graph, c.eid, setEdgeDimension); // construction behåller värde; diag nollas
      demotedAny = true;
    }
  }

  if (demotedAny) {
    // Fyll derived-värden efter demotion
    recomputeComponentFromScratch(graph, diagEid, setEdgeDimension, opts);
  }
}

export function autosolveDiagonal_LockTwoLatest_AdjustOldest(graph, diagEid, setEdgeDimension, opts = {}) {
  const eD = graph.getEdge(diagEid); if (!eD) return;
  const dimD = eD.dim || null;
  if (!dimD || dimD.source !== 'user') return;
  if (!validNumber(dimD.valueMm)) return;

  const path = findManhattanPath(graph, eD.a, eD.b);
  if (!path || path.edges.length === 0) return;

  const rec = [];
  rec.push({ type:'diag', eid: eD.id, stamp: getUserEditedAt(eD) });

  const candEdges = [];
  for (let i=0;i<path.edges.length;i++){
    const eid = path.edges[i];
    const ed  = graph.getEdge(eid);
    if (!ed || ed.kind !== 'construction') continue;

    const aId = path.nodes[i], bId = path.nodes[i+1];
    const aM  = graph.getNode(aId)?.meta?.metric;
    const bM  = graph.getNode(bId)?.meta?.metric;
    const aW  = graph.getNodeWorldPos(aId), bW = graph.getNodeWorldPos(bId);

    const dW = { x:bW.x-aW.x, y:bW.y-aW.y, z:bW.z-aW.z };
    const axis = dominantAxis(dW);

    const dM = (aM?.known && bM?.known) ? { x:bM.x-aM.x, y:bM.y-aM.y, z:bM.z-aM.z } : dW;
    const key = axis.toLowerCase();
    const sign = (Math.abs(dM[key]) > 1e-9) ? Math.sign(dM[key]) : ((Math.abs(dW[key]) > 1e-9) ? Math.sign(dW[key]) : 1);

    const stamp = getUserEditedAt(ed);
    rec.push({ type:'leg', eid, axis, sign, stamp });
    candEdges.push({ eid, axis, sign, stamp, dim: ed.dim || null, idx:i });
  }

  if (!candEdges.length) return;
  opts.dumpPathAndRecency?.(graph, path, rec, { title: 'Autosolve: path + recency' });

  rec.sort((a,b)=> (b.stamp - a.stamp));
  const topTwo = new Set(rec.slice(0,2).map(x => x.eid));

  // Äldsta kandidat som inte är i topTwo
  let pick = candEdges
    .filter(c => !topTwo.has(c.eid))
    .sort((a,b)=> (a.stamp - b.stamp) || a.eid.localeCompare(b.eid))[0];
  if (!pick) pick = candEdges.sort((a,b)=> (a.stamp - b.stamp) || a.eid.localeCompare(b.eid))[0];
  if (!pick) return;

  // Om pick var user → demota (behåll värde om construction)
  if (pick.dim?.source === 'user') {
    demoteOneEdge(graph, pick.eid, setEdgeDimension);
    recomputeComponentFromScratch(graph, diagEid, setEdgeDimension, opts);
  }

  // Totalsummor mellan pathens ändpunkter
  const startM = graph.getNode(path.nodes[0])?.meta?.metric;
  const endM   = graph.getNode(path.nodes[path.nodes.length-1])?.meta?.metric;
  if (!startM?.known || !endM?.known) return;

  const dTot = { x:endM.x - startM.x, y:endM.y - startM.y, z:endM.z - startM.z };
  const dTarget = dimD.valueMm;
  const key     = pick.axis.toLowerCase();

  const curAxisTotal = dTot[key];
  const other2sq =
    (key === 'x') ? (dTot.y*dTot.y + dTot.z*dTot.z) :
    (key === 'y') ? (dTot.x*dTot.x + dTot.z*dTot.z) :
                    (dTot.x*dTot.x + dTot.y*dTot.y);

  const reqSq = dTarget*dTarget - other2sq;
  if (reqSq < -1e-9) {
    const dimNow = graph.getEdge(diagEid).dim || {};
    setEdgeDimension(diagEid, { ...dimNow, conflict:{ deltaMm: Math.sqrt(other2sq) - dTarget } }, { silent:false });
    return;
  }

  const mag       = Math.sqrt(Math.max(0, reqSq));
  const signTotal = (Math.abs(curAxisTotal) > 1e-9) ? Math.sign(curAxisTotal) : (pick.sign || 1);
  const newAxisTotal = mag * signTotal;

  // Segmentets nuvarande signed-komponent
  const idx = pick.idx;
  const segStart = graph.getNode(path.nodes[idx])?.meta?.metric;
  const segEnd   = graph.getNode(path.nodes[idx+1])?.meta?.metric;
  if (!segStart?.known || !segEnd?.known) return;

  const segDM = { x:segEnd.x - segStart.x, y:segEnd.y - segStart.y, z:segEnd.z - segStart.z };
  const oldPickSigned = segDM[key];

  const sumOthers = curAxisTotal - oldPickSigned;
  const newPickSigned = newAxisTotal - sumOthers;
  const newSegLen = Math.abs(newPickSigned);

  writeDerivedLen(graph, pick.eid, newSegLen, setEdgeDimension);
  opts.dumpComponentAroundEdge?.(graph, diagEid, { title: 'AFTER autosolve write' });

  recomputeComponentFromScratch(graph, diagEid, setEdgeDimension, opts);
  opts.dumpComponentAroundEdge?.(graph, diagEid, { title: 'AFTER final recompute' });
}

// Hjälpare som behövs i metricSolver också
export function listUserCenterEdgesInComponent(graph, edgeId) {
  const { edges } = collectComponentFromEdge(graph, edgeId);
  const out = [];
  for (const eid of edges) {
    const e = graph.getEdge(eid);
    if (!e || e.kind !== 'center') continue;
    if ((e.dim?.source || null) === 'user') out.push(e);
  }
  return out;
}

// ── interna helpers ───────────────────────────────────────────────────────────
function validNumber(x){ return (typeof x === 'number' && isFinite(x)) ? x : null; }

function getUserEditedAt(edge){
  const t = edge?.dim?.userEditedAt;
  return (typeof t === 'number' && isFinite(t)) ? t : Number.NEGATIVE_INFINITY;
}

function edgeCurrentLengthFromMetricOrWorld(g, e) {
  const aM = g.getNode(e.a)?.meta?.metric;
  const bM = g.getNode(e.b)?.meta?.metric;
  if (aM?.known && bM?.known) return dist3(aM, bM);

  const aW = g.getNodeWorldPos(e.a), bW = g.getNodeWorldPos(e.b);
  if (!aW || !bW) return 0;

  if (e.kind === 'construction') {
    const axis = dominantAxis({ x:bW.x-aW.x, y:bW.y-aW.y, z:bW.z-aW.z });
    const k = axis.toLowerCase();
    return Math.abs(bW[k] - aW[k]); // strikt axelkomponent
  }
  return Math.hypot(bW.x-aW.x, bW.y-aW.y, bW.z-aW.z);
}

function demoteOneEdge(g, eid, setEdgeDimension) {
  const ed = g.getEdge(eid);
  const prev = ed?.dim || {};
  const isConstruction = ed?.kind === 'construction';

  let keepValue = prev.valueMm;
  if (!(typeof keepValue === 'number' && isFinite(keepValue))) {
    keepValue = edgeCurrentLengthFromMetricOrWorld(g, ed);
  }

  setEdgeDimension(eid, {
    valueMm: isConstruction ? keepValue : null,
    mode: prev.mode || 'aligned',
    label: prev.label ?? null,
    source: 'derived',
    derivedFrom: { kind:'autoDemote', was:'user' },
    conflict: null
  }, { silent:false });
}

function writeDerivedLen(g, eid, valueMm, setEdgeDimension) {
  const dim = g.getEdge(eid)?.dim || {};
  setEdgeDimension(eid, {
    valueMm,
    mode: dim?.mode || 'aligned',
    label: dim?.label ?? null,
    source: 'derived',
    derivedFrom: { kind:'lockTwo_adjustOldest' },
    conflict: null
  }, { silent:false });
}

function findManhattanPath(g, startN, goalN) {
  if (startN === goalN) return { nodes:[startN], edges:[] };
  const q = [startN];
  const prevNode = new Map(), prevEdge = new Map();
  prevNode.set(startN, null);

  while (q.length) {
    const nid = q.shift();
    const inc = g.incidentEdges(nid, { kind:'construction' });
    for (const e of inc) {
      const other = (e.a === nid) ? e.b : e.a;
      if (!prevNode.has(other)) {
        prevNode.set(other, nid);
        prevEdge.set(other, e.id);
        q.push(other);
        if (other === goalN) break;
      }
    }
    if (prevNode.has(goalN)) break;
  }
  if (!prevNode.has(goalN)) return null;

  const nodes = []; const edges = [];
  let cur = goalN;
  while (cur != null) {
    nodes.push(cur);
    const p = prevNode.get(cur);
    if (p != null) edges.push(prevEdge.get(cur));
    cur = p;
  }
  nodes.reverse(); edges.reverse();
  return { nodes, edges };
}

function collectComponentFromEdge(g, startEid) {
  const e0 = g.getEdge(startEid); if (!e0) return { nodes:[], edges:[] };
  const seenN = new Set(), seenE = new Set(); const q = [];
  seenN.add(e0.a); seenN.add(e0.b); q.push(e0.a, e0.b); seenE.add(startEid);
  while (q.length) {
    const nid = q.shift();
    const bag = g.incidentEdges(nid, {});
    for (const e of bag) {
      if (!seenE.has(e.id)) seenE.add(e.id);
      const other = (e.a === nid) ? e.b : e.a;
      if (!seenN.has(other)) { seenN.add(other); q.push(other); }
    }
  }
  return { nodes:[...seenN], edges:[...seenE] };
}

function findWorldOriginNode(g, nodeIds, eps=1e-9) {
  for (const nid of nodeIds) {
    const p = g.getNodeWorldPos(nid);
    if (Math.abs(p.x)<=eps && Math.abs(p.y)<=eps && Math.abs(p.z)<=eps) return nid;
  }
  return null;
}

function hasConstructionPathBetween(g, a, b) {
  const p = findManhattanPath(g, a, b);
  return !!(p && p.edges && p.edges.length);
}

function edgeUnitDirWorld(g, e) {
  const a = g.getNodeWorldPos(e.a), b = g.getNodeWorldPos(e.b);
  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;

  if (e.kind === 'construction') {
    const ax = dominantAxis({x:dx,y:dy,z:dz});
    const sx = (ax==='X') ? (Math.sign(dx)||1) : 0;
    const sy = (ax==='Y') ? (Math.sign(dy)||1) : 0;
    const sz = (ax==='Z') ? (Math.sign(dz)||1) : 0;
    return { x:sx, y:sy, z:sz };
  }
  const L = Math.hypot(dx,dy,dz) || 1;
  return { x:dx/L, y:dy/L, z:dz/L };
}

function dist3(a,b){ return Math.hypot(b.x-a.x, b.y-a.y, b.z-a.z); }

function dominantAxis(d){
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return 'X';
  if (az >= ax && az >= ay) return 'Z';
  return 'Y';
}
