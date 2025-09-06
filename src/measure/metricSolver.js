// ──────────────────────────────────────────────────────────────────────────────
// src/measure/metricSolver.js
// Två-fas propagation + normalisering av lås + autosolve (as-drawn, stateless)
// ──────────────────────────────────────────────────────────────────────────────

import { dumpComponentAroundEdge, dumpPathAndRecency } from '../debug/metricTrace.js';

const TRACE = true;
const DEBUG = false;
const log  = (...a)=>{ if (DEBUG) console.log('[metric]', ...a); };
const TOL = 0.1; // mm

let gRef = null;
let inBatch = false;

export function init({ graph }) {
  gRef = graph;

  graph.onEdgeDimensionChanged?.((eid) => {
    if (inBatch) return;
    const g = gRef; const changed = g?.getEdge(eid); if (!changed) return;

    // 1) Alltid: recompute (Fas 1 + Fas 2)
    recomputeComponent(eid);

    // 2) Hitta alla user-diagonaler (center) i samma komponent
    const diagsBefore = listUserCenterEdgesInComponent(g, eid);
    if (!diagsBefore.length) return;

    // 3) Normalisera låsbudget runt varje diagonal (recency bestämmer; även diag kan släppas)
    for (const d of diagsBefore) normalizeLocksForDiagonal(g, d.id);

    // 4) Recompute och autosolve för kvarvarande user-diagonaler
    const diagsAfter = listUserCenterEdgesInComponent(g, eid);
    for (const d of diagsAfter) {
      recomputeComponent(d.id);
      autosolveDiagonal_LockTwoLatest_AdjustOldest(d.id);
    }
  });

  log('metric solver ready (two-phase + lock normalization + autosolve)');
}

// ──────────────────────────────────────────────────────────────────────────────
// Recompute: Fas 1 (construction-only) + Fas 2 (derive/validate)
// ──────────────────────────────────────────────────────────────────────────────
function recomputeComponent(edgeId) {
  const g = gRef; if (!g) return;
  const e0 = g.getEdge(edgeId); if (!e0) return;

  const { nodes: compNodes, edges: compEdges } = collectComponentFromEdge(g, edgeId);
  if (!compNodes.length) return;

  // Nolla metric
  for (const nid of compNodes) {
    const n = g.getNode(nid);
    n.meta = n.meta || {};
    n.meta.metric = { x:0, y:0, z:0, known:false };
  }

  const hasConstruction = compEdges.some(eid => g.getEdge(eid)?.kind === 'construction');

  // Seed: origo om möjligt
  const originId = findWorldOriginNode(g, compNodes) ?? compNodes[0];
  g.getNode(originId).meta.metric = { x:0, y:0, z:0, known:true };

  // Fas 1: endast via construction om sådana finns; annars fallback center
  let changed = true, guard = 0;
  while (changed && guard < 3 * compEdges.length + 10) {
    changed = false; guard++;
    for (const eid of compEdges) {
      const ed = g.getEdge(eid); if (!ed) continue;
      if (hasConstruction && ed.kind !== 'construction') continue;

      const dim = ed.dim;
      const val = (dim && typeof dim.valueMm === 'number' && isFinite(dim.valueMm)) ? dim.valueMm : null;
      if (val == null) continue;

      const a = g.getNode(ed.a), b = g.getNode(ed.b);
      const mA = a.meta.metric, mB = b.meta.metric;
      const dir = edgeUnitDirWorld(g, ed); // axelrät för construction

      if (mA.known && !mB.known) {
        b.meta.metric = { x:mA.x+dir.x*val, y:mA.y+dir.y*val, z:mA.z+dir.z*val, known:true };
        changed = true;
      } else if (!mA.known && mB.known) {
        a.meta.metric = { x:mB.x-dir.x*val, y:mB.y-dir.y*val, z:mB.z-dir.z*val, known:true };
        changed = true;
      }
    }
  }

  // Fas 2: derive/validera från node.metric
  for (const eid of compEdges) {
    const ed = g.getEdge(eid); if (!ed) continue;
    const aM = g.getNode(ed.a)?.meta?.metric;
    const bM = g.getNode(ed.b)?.meta?.metric;
    if (!aM?.known || !bM?.known) continue;

    const d = dist3(aM, bM);
    const dim = ed.dim || null;
    const isUser = dim?.source === 'user';

    if (isUser) {
      const delta = Math.abs((dim.valueMm ?? 0) - d);
      const hadConflict = !!dim?.conflict;
      if (delta > TOL && !hadConflict) {
        inBatch = true; g.setEdgeDimension(eid, { ...dim, conflict: { deltaMm: delta } }, { silent: true }); inBatch = false;
      } else if (delta <= TOL && hadConflict) {
        inBatch = true; g.setEdgeDimension(eid, { ...dim, conflict: null }, { silent: true }); inBatch = false;
      }
    } else {
      inBatch = true;
      g.setEdgeDimension(eid, {
        valueMm: d,
        mode: dim?.mode || 'aligned',
        label: dim?.label ?? null,
        source: 'derived',
        derivedFrom: 'metric',
        conflict: null
      }, { silent: false });
      inBatch = false;
    }
  }

  if (TRACE) dumpComponentAroundEdge(g, edgeId, { title: 'AFTER recompute' });
}

// ──────────────────────────────────────────────────────────────────────────────
// Lås-normalisering: behåll k senaste (k = #unika axlar i path), demota övriga
// ──────────────────────────────────────────────────────────────────────────────
function normalizeLocksForDiagonal(g, diagEid) {
  const eD = g.getEdge(diagEid); if (!eD || eD.kind !== 'center') return;
  const dimD = eD.dim || null;
  if (!dimD || dimD.source !== 'user') return; // bara user-diagonaler

  const path = findManhattanPath(g, eD.a, eD.b);
  if (!path || path.edges.length === 0) return;

  // Samla legs + vilka axlar som används
  const axesUsed = new Set();
  const legs = [];
  for (let i=0;i<path.edges.length;i++){
    const eid = path.edges[i];
    const ed  = g.getEdge(eid);
    if (!ed || ed.kind !== 'construction') continue;

    const aW = g.getNodeWorldPos(path.nodes[i]);
    const bW = g.getNodeWorldPos(path.nodes[i+1]);
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

  if (TRACE) {
    console.group('[TRACE] Normalize locks (recency keeps k)');
    console.table(candidates.map(c => ({ eid:c.eid, type:c.type, axis:c.axis, stamp:c.stamp, source:c.dim?.source || null })));
    console.log('k=', k, 'kept=', [...keep]);
    console.groupEnd();
  }

  // Demota alla usersatta som inte är i "keep"
  let demotedAny = false;
  for (const c of candidates) {
    if (!keep.has(c.eid) && c.dim?.source === 'user') {
      demoteOneEdge(g, c.eid);     // ⟵ konstruktion behåller numeriskt värde; diagonal nollas
      demotedAny = true;
    }
  }

  if (demotedAny) {
    // Fyll direkt in nya derived-värden (diagonaler m.m.) baserat på nuvarande construction
    recomputeComponent(diagEid);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Autosolve: lås två senaste, justera äldst (as-drawn, totalsummor per axel)
// ──────────────────────────────────────────────────────────────────────────────
function autosolveDiagonal_LockTwoLatest_AdjustOldest(diagEid) {
  const g = gRef; if (!g) return;
  const eD = g.getEdge(diagEid); if (!eD) return;
  const dimD = eD.dim || null;
  if (!dimD || dimD.source !== 'user') return;
  if (typeof dimD.valueMm !== 'number' || !isFinite(dimD.valueMm)) return;

  const path = findManhattanPath(g, eD.a, eD.b);
  if (!path || path.edges.length === 0) return;

  const rec = [];
  rec.push({ type:'diag', eid: eD.id, stamp: getUserEditedAt(eD) });

  const candEdges = [];
  for (let i=0;i<path.edges.length;i++){
    const eid = path.edges[i];
    const ed  = g.getEdge(eid);
    if (!ed || ed.kind !== 'construction') continue;

    const aId = path.nodes[i], bId = path.nodes[i+1];
    const aM  = g.getNode(aId)?.meta?.metric;
    const bM  = g.getNode(bId)?.meta?.metric;
    const aW  = g.getNodeWorldPos(aId), bW = g.getNodeWorldPos(bId);

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
  if (TRACE) dumpPathAndRecency(g, path, rec, { title: 'Autosolve: path + recency' });

  rec.sort((a,b)=> (b.stamp - a.stamp));
  const topTwo = new Set(rec.slice(0,2).map(x => x.eid));

  let pick = candEdges
    .filter(c => !topTwo.has(c.eid))
    .sort((a,b)=> (a.stamp - b.stamp) || a.eid.localeCompare(b.eid))[0];
  if (!pick) pick = candEdges.sort((a,b)=> (a.stamp - b.stamp) || a.eid.localeCompare(b.eid))[0];
  if (!pick) return;

  if (TRACE) {
    console.group('[TRACE] Autosolve: pick to adjust');
    console.log('pick', pick);
    console.groupEnd();
  }

  // Om pick var user → demota (behåll värde om construction)
  if (pick.dim?.source === 'user') {
    demoteOneEdge(g, pick.eid);
    recomputeComponent(diagEid);
  }

  // Totalsummor i pathens riktning
  const startM = g.getNode(path.nodes[0])?.meta?.metric;
  const endM   = g.getNode(path.nodes[path.nodes.length-1])?.meta?.metric;
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
    const dimNow = g.getEdge(diagEid).dim || {};
    inBatch = true; g.setEdgeDimension(diagEid, { ...dimNow, conflict:{ deltaMm: Math.sqrt(other2sq) - dTarget } }, { silent:false }); inBatch = false;
    return;
  }

  const mag       = Math.sqrt(Math.max(0, reqSq));
  const signTotal = (Math.abs(curAxisTotal) > 1e-9) ? Math.sign(curAxisTotal) : (pick.sign || 1);
  const newAxisTotal = mag * signTotal;

  // Nuvarande signed-komponent för pick-segmentet
  const idx = pick.idx;
  const segStart = g.getNode(path.nodes[idx])?.meta?.metric;
  const segEnd   = g.getNode(path.nodes[idx+1])?.meta?.metric;
  if (!segStart?.known || !segEnd?.known) return;

  const segDM = { x:segEnd.x - segStart.x, y:segEnd.y - segStart.y, z:segEnd.z - segStart.z };
  const oldPickSigned = segDM[key];

  const sumOthers = curAxisTotal - oldPickSigned;
  const newPickSigned = newAxisTotal - sumOthers;
  const newSegLen = Math.abs(newPickSigned);

  writeDerivedLen(g, pick.eid, newSegLen);
  if (TRACE) dumpComponentAroundEdge(g, diagEid, { title: 'AFTER autosolve write' });

  recomputeComponent(diagEid);
  if (TRACE) dumpComponentAroundEdge(g, diagEid, { title: 'AFTER final recompute' });
}

// ──────────────────────────────────────────────────────────────────────────────
// Hjälpare
// ──────────────────────────────────────────────────────────────────────────────
function listUserCenterEdgesInComponent(g, edgeId) {
  const { edges } = collectComponentFromEdge(g, edgeId);
  const out = [];
  for (const eid of edges) {
    const e = g.getEdge(eid);
    if (!e || e.kind !== 'center') continue;
    if ((e.dim?.source || null) === 'user') out.push(e);
  }
  return out;
}

function getUserEditedAt(edge){
  const t = edge?.dim?.userEditedAt;
  return (typeof t === 'number' && isFinite(t)) ? t : Number.NEGATIVE_INFINITY;
}

// Mät aktuell längd för en kant (före vi ändrar något)
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

// Demotion: construction behåller numeriskt värde; center (diag) nollas
function demoteOneEdge(g, eid) {
  const ed = g.getEdge(eid);
  const prev = ed?.dim || {};
  const isConstruction = ed?.kind === 'construction';

  let keepValue = prev.valueMm;
  if (!(typeof keepValue === 'number' && isFinite(keepValue))) {
    keepValue = edgeCurrentLengthFromMetricOrWorld(g, ed);
  }

  inBatch = true;
  g.setEdgeDimension(eid, {
    valueMm: isConstruction ? keepValue : null, // ⟵ viktigt
    mode: prev.mode || 'aligned',
    label: prev.label ?? null,
    source: 'derived',
    derivedFrom: { kind:'autoDemote', was:'user' },
    conflict: null
  }, { silent:false });
  inBatch = false;
}

function writeDerivedLen(g, eid, valueMm) {
  const ed = g.getEdge(eid);
  const dim = ed?.dim || {};
  inBatch = true;
  g.setEdgeDimension(eid, {
    valueMm,
    mode: dim?.mode || 'aligned',
    label: dim?.label ?? null,
    source: 'derived',
    derivedFrom: { kind:'lockTwo_adjustOldest' },
    conflict: null
  }, { silent:false });
  inBatch = false;
}

// BFS via CONSTRUCTION-kanter
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

// Enhetsriktning: construction → strikt axelrät
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
