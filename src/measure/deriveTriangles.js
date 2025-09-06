// src/measure/deriveTriangles.js
// Right-triangle derivation: two orthogonal construction legs A→P, A→Q + one center diagonal P↔Q.
// Policy: max en 'derived' per triangel; den du ändrar är alltid 'user'.

const DEBUG_TRI = true;
const log  = (...a)=>{ if (DEBUG_TRI) console.log('[TRI]', ...a); };
const warn = (...a)=>{ if (DEBUG_TRI) console.warn('[TRI]', ...a); };

let graphRef = null;
let inBatch = false;

export function init({ graph }) {
  graphRef = graph;
  graph.onEdgeDimensionChanged?.((eid) => {
    if (inBatch) return;
    handleEdgeDimChange(eid);
  });
  log('init: listening for edge dimension changes');
}

function handleEdgeDimChange(edgeId) {
  const g = graphRef; if (!g) return;
  const e = g.getEdge(edgeId); if (!e) return;
  const dim = e.dim || null;
  log('onEdgeDimensionChanged:', edgeId, { kind:e.kind, dim });

  const tris = findTrianglesTouchingEdge(g, edgeId);
  log('triangles touching', edgeId, '→', tris.length);
  for (const tri of tris) applyTrianglePolicy(g, tri, edgeId);
}

function axisOfEdge(g, e){
  const a = g.getNodeWorldPos(e.a), b = g.getNodeWorldPos(e.b);
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), dz = Math.abs(b.z - a.z);
  const ax = (dx >= dy && dx >= dz) ? 'X' : (dz >= dx && dz >= dy) ? 'Z' : 'Y';
  return { ax, dx, dy, dz };
}
const areOrthogonal = (a,b)=> a !== b;

// Diagonalen ska ligga i planet som spänns av axlarna (ax1,ax2) och ha exakt
// de två komponenterna ≠ 0, den tredje nära 0.
function isDiagonalInPlane(g, e, ax1, ax2, eps = 1e-6){
  const a = g.getNodeWorldPos(e.a);
  const b = g.getNodeWorldPos(e.b);
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const dz = Math.abs(b.z - a.z);

  const hasX = dx > eps, hasY = dy > eps, hasZ = dz > eps;
  const count = (hasX?1:0) + (hasY?1:0) + (hasZ?1:0);

  // Debug
  log('diag plane check', e.id, { dx,dy,dz, hasX,hasY,hasZ, ax1,ax2 });

  if (count !== 2) return false; // ren axel (1) eller 3D-diag (3) → nej

  // måste vara exakt de två axlar vi väntar oss
  const needX = (ax1 === 'X' || ax2 === 'X');
  const needY = (ax1 === 'Y' || ax2 === 'Y');
  const needZ = (ax1 === 'Z' || ax2 === 'Z');

  if (needX !== hasX) return false;
  if (needY !== hasY) return false;
  if (needZ !== hasZ) return false;

  return true;
}

function findTrianglesTouchingEdge(g, eid){
  const e = g.getEdge(eid);
  if (!e) return [];
  const out = [];
  const isConst  = ed => ed.kind === 'construction';
  const isCenter = ed => ed.kind === 'center';
  const seen = new Set();

  function addTri(A, P, Q, eAP, eAQ, ePQ){
    const key = [A,P,Q].sort().join('|');
    if (seen.has(key)) return;

    const ax1 = axisOfEdge(g, eAP).ax;
    const ax2 = axisOfEdge(g, eAQ).ax;
    if (!areOrthogonal(ax1, ax2)) {
      log('reject tri: legs not orthogonal', {A, P, Q, eAP: eAP.id, eAQ: eAQ.id, ax1, ax2});
      return;
    }

    if (!isDiagonalInPlane(g, ePQ, ax1, ax2)) {
      log('reject tri: diagonal not in plane', { ePQ: ePQ.id, ax1, ax2 });
      return;
    }

    seen.add(key);
    out.push({ A, P, Q, eAPId: eAP.id, eAQId: eAQ.id, ePQId: ePQ.id, ax1, ax2 });
    log('accept tri', { A, P, Q, eAP: eAP.id, eAQ: eAQ.id, ePQ: ePQ.id, ax1, ax2 });
  }

  // Case 1: construction edge – använd varje ändpunkt som hörn A
  if (isConst(e)){
    for (const A of [e.a, e.b]){
      const P = (A === e.a) ? e.b : e.a;
      const legs = graphRef.incidentEdges(A, { kind:'construction' });
      log('incident legs @A', A, legs.map(x=>x.id));
      for (const eAQ of legs) {
        if (eAQ.id === eid) continue;
        const Q = (A === eAQ.a) ? eAQ.b : eAQ.a;
        const ePQ = findEdgeBetween(g, P, Q, { kind:'center' });
        if (!ePQ) {
          log('no diagonal P<->Q', {P, Q});
          continue;
        }
        addTri(A, P, Q, e, eAQ, ePQ);
      }
    }
  }

  // Case 2: center edge – matcha ett hörn A som har två ortogonala konstruktioner till P resp Q
  if (isCenter(e)){
    const P = e.a, Q = e.b;
    const consP = graphRef.incidentEdges(P, { kind:'construction' });
    const consQ = graphRef.incidentEdges(Q, { kind:'construction' });
    log('center edge; cons@P', P, consP.map(x=>x.id), 'cons@Q', Q, consQ.map(x=>x.id));
    for (const eAP of consP){
      for (const eAQ of consQ){
        const A1 = (P === eAP.a) ? eAP.b : eAP.a;
        const A2 = (Q === eAQ.a) ? eAQ.b : eAQ.a;
        if (A1 !== A2) continue; // måste dela hörn
        addTri(A1, P, Q, eAP, eAQ, e);
      }
    }
  }
  return out;
}

function findEdgeBetween(g, n1, n2, filter){
  for (const [id, ed] of g.allEdges()){
    if ((ed.a === n1 && ed.b === n2) || (ed.a === n2 && ed.b === n1)){
      if (!filter || !filter.kind || ed.kind === filter.kind) return ed;
    }
  }
  return null;
}

function getDim(g, eid){
  const e = g.getEdge(eid);
  const d = e?.dim || null;
  return {
    value: (d && typeof d.valueMm === 'number' && isFinite(d.valueMm)) ? d.valueMm : null,
    source: d?.source || null,
    userEditedAt: d?.userEditedAt || null,
    raw: d || null,
  };
}

function setDerived(g, eid, value, derivedFrom){
  inBatch = true;
  log('→ setDerived', { eid, value, derivedFrom });
  g.setEdgeDimension(eid, {
    valueMm: value,
    source: 'derived',
    derivedFrom
  }, { silent: false });
  inBatch = false;
}

function setAsUserKeepValue(g, eid){
  const d = getDim(g, eid);
  if (d.value == null) return;
  inBatch = true;
  log('→ lockAsUser', { eid, value:d.value, was:d.source, at:d.userEditedAt });
  g.setEdgeDimension(eid, {
    valueMm: d.value,
    source: 'user',
    userEditedAt: d.userEditedAt || Date.now(),
    label: d.raw?.label,
    mode:  d.raw?.mode || 'aligned',
    conflict: null,
  }, { silent: true });
  inBatch = false;
}

function applyTrianglePolicy(g, tri, editedEid){
  const eA = tri.eAPId; // leg 1
  const eB = tri.eAQId; // leg 2
  const eD = tri.ePQId; // diagonal

  const dA = getDim(g, eA);
  const dB = getDim(g, eB);
  const dD = getDim(g, eD);

  log('apply policy on tri', tri, {
    dims: { A:dA, B:dB, D:dD }, edited: editedEid
  });

  const known = [
    { id:eA, role:'leg1', ...dA },
    { id:eB, role:'leg2', ...dB },
    { id:eD, role:'diag', ...dD },
  ];
  if (known.filter(k=>k.value != null).length < 2) {
    log('skip: <2 known values');
    return;
  }

  // Lås exakt två som 'user': edited edge + den med högst userEditedAt (eller den som har värde)
  const byId = Object.fromEntries(known.map(k=>[k.id, k]));
  const remain = known.filter(k=>k.id !== editedEid);
  let second = remain
    .filter(k => k.source === 'user')
    .sort((a,b)=>(b.userEditedAt||0)-(a.userEditedAt||0))[0];
  if (!second) second = remain.filter(k=>k.value != null)[0];

  log('locking users:', { edited: editedEid, second: second?.id });

  setAsUserKeepValue(g, editedEid);
  if (second) setAsUserKeepValue(g, second.id);

  const target = known.find(k => k.id !== editedEid && (!second || k.id !== second.id));
  if (!target) { warn('no derived target found'); return; }

  const k1 = byId[editedEid], k2 = second ? byId[second.id] : null;
  if (!k2 || k1.value == null || k2.value == null) {
    warn('cannot derive: missing two user values');
    return;
  }

  const roles = [k1.role, k2.role].sort().join('+');
  let newValue = null, ok = true;

  if (roles === 'leg1+leg2'){
    newValue = Math.sqrt(Math.max(0, (byId[eA].value||0)**2 + (byId[eB].value||0)**2));
  } else if (roles === 'diag+leg1'){
    const d = byId[eD].value||0, a = byId[eA].value||0;
    ok = d >= a; newValue = ok ? Math.sqrt(Math.max(0, d*d - a*a)) : null;
  } else if (roles === 'diag+leg2'){
    const d = byId[eD].value||0, b = byId[eB].value||0;
    ok = d >= b; newValue = ok ? Math.sqrt(Math.max(0, d*d - b*b)) : null;
  } else {
    warn('unexpected roles combination', roles);
    return;
  }

  log('derive target', { target: target.id, roles, newValue, ok });

  if (ok && isFinite(newValue)) {
    setDerived(g, target.id, newValue, { from:[k1.id, k2.id] });
  } else {
    const cur = g.getEdge(target.id)?.dim || {};
    const need = { ...cur, conflict: { reason:'infeasible', roles, edited:editedEid } };
    inBatch = true;
    warn('mark conflict on', target.id, need.conflict);
    g.setEdgeDimension(target.id, need, { silent: true });
    inBatch = false;
  }
}
