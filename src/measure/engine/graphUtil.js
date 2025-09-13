// ──────────────────────────────────────────────────────────────────────────────
// src/measure/engine/graphUtil.js
// Små hjälpare som delas mellan propagate/normalize/autosolve/chains
// ──────────────────────────────────────────────────────────────────────────────

import { findManhattanPath } from './paths.js';

// Returnera dim från lösningens cache om den finns, annars från grafen
export function getEdgeDim(g, eid, solEdges) {
  return solEdges?.get(eid) ?? g.getEdge(eid)?.dim ?? null;
}

// Samla ihop en hel komponent utifrån en kant
export function collectComponentFromEdge(g, startEid) {
  const e0 = g.getEdge(startEid);
  if (!e0) return { nodes: [], edges: [] };

  const seenN = new Set();
  const seenE = new Set();
  const q = [];

  seenN.add(e0.a);
  seenN.add(e0.b);
  seenE.add(startEid);
  q.push(e0.a, e0.b);

  while (q.length) {
    const nid = q.shift();
    const inc = g.incidentEdges(nid, {}); // alla kanter
    for (const e of inc) {
      if (!seenE.has(e.id)) seenE.add(e.id);
      const other = (e.a === nid) ? e.b : e.a;
      if (!seenN.has(other)) { seenN.add(other); q.push(other); }
    }
  }
  return { nodes: [...seenN], edges: [...seenE] };
}

// Hitta en nod i (0,0,0) i world, om någon
export function findWorldOriginNode(g, nodeIds, eps = 1e-9) {
  for (const nid of nodeIds) {
    const p = g.getNodeWorldPos(nid);
    if (p && Math.abs(p.x) <= eps && Math.abs(p.y) <= eps && Math.abs(p.z) <= eps) {
      return nid;
    }
  }
  return null;
}

// Finns en ren construction-path mellan a och b?
export function hasConstructionPathBetween(g, a, b) {
  const p = findManhattanPath(g, a, b);
  return !!(p && p.edges && p.edges.length);
}

// Enhetsriktning i world för en kant (axelrät för construction, annars normaliserad)
export function edgeUnitDirWorld(g, e) {
  const a = g.getNodeWorldPos(e.a);
  const b = g.getNodeWorldPos(e.b);
  if (!a || !b) return { x: 1, y: 0, z: 0 };

  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;

  if (e.kind === 'construction') {
    const ax = dominantAxis({ x: dx, y: dy, z: dz });
    const sx = (ax === 'X') ? (Math.sign(dx) || 1) : 0;
    const sy = (ax === 'Y') ? (Math.sign(dy) || 1) : 0;
    const sz = (ax === 'Z') ? (Math.sign(dz) || 1) : 0;
    return { x: sx, y: sy, z: sz };
  }

  const L = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / L, y: dy / L, z: dz / L };
}

// Lista user-satta center-kanter i samma komponent som en given kant
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

// ── interna småhjälpare ───────────────────────────────────────────────────────
function dominantAxis(d) {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return 'X';
  if (az >= ax && az >= ay) return 'Z';
  return 'Y';
}
