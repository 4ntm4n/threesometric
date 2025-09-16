// ──────────────────────────────────────────────────────────────
// src/calculation/calculator.js
// Kalkylatorn: översätter receptet (graph) till metrisk modell (mm)
// - On-demand, skriver aldrig tillbaka i grafen
// - Stöd: axisLock, parallelTo, perpTo, angleTo (+ planeRef)
// - Fallback: triangulering (två kända grannar + planeRef)
// - Traverserar i pass tills alla noder är placerade eller inget mer går
// ──────────────────────────────────────────────────────────────

import { isGraphSolvable } from './stateManager.js';

// ──────────────────────────────────────────────────────────────
// Vektorhjälp
const EPS = 1e-9;
function v(x=0,y=0,z=0){ return {x,y,z}; }
function add(a,b){ return {x:a.x+b.x,y:a.y+b.y,z:a.z+b.z}; }
function sub(a,b){ return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}; }
function mul(a,s){ return {x:a.x*s,y:a.y*s,z:a.z*s}; }
function dot(a,b){ return a.x*b.x + a.y*b.y + a.z*b.z; }
function cross(a,b){ return { x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x }; }
function len(a){ return Math.hypot(a.x,a.y,a.z); }
function norm(a){ const L = len(a); return L>EPS ? mul(a,1/L) : v(); }
function clamp(x,min,max){ return Math.max(min, Math.min(max, x)); }
function nearZero(x){ return Math.abs(x) < EPS; }
const GLOBAL_UP = v(0,1,0);

// Rodrigues rotation: rotera v runt axeln k (enhetsvektor) med vinkel rad
function rotateAroundAxis(vec, axisUnit, angleRad){
  const k = axisUnit;
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  const term1 = mul(vec, c);
  const term2 = mul(cross(k, vec), s);
  const term3 = mul(k, dot(k, vec) * (1 - c));
  return add(add(term1, term2), term3);
}

// ──────────────────────────────────────────────────────────────
// Topologi/help
function incidentEdgesOf(graph, nodeId){
  if (graph.adj && graph.allEdges) {
    const bag = graph.adj.get(nodeId) || new Set();
    const edges = graph.allEdges();
    const out = [];
    for (const eid of bag) { const e = edges.get(eid); if (e) out.push(e); }
    return out;
  }
  return graph.incidentEdges?.(nodeId) || [];
}
function otherOf(e, nid){ return (e.a===nid)? e.b : e.a; }
function hasDim(e){
  const d = e?.dim?.valueMm;
  return typeof d === 'number' && isFinite(d) && d > 0;
}

// Riktning för referenskant (enhetsvektor a→b) om båda noder placerade
function refEdgeDirection(edges, coords, edgeId){
  const ref = edges.get(edgeId);
  if (!ref) return null;
  const A = coords.get(ref.a), B = coords.get(ref.b);
  if (!A || !B) return null;
  return norm(sub(B, A));
}

// Hämta plane normal (enhetsvektor) från PlaneRef
function planeNormalFromRef(planeRef, edges, coords){
  if (!planeRef) return null;
  if (planeRef.type === 'byEdges') {
    const [eA, eB] = planeRef.refs || [];
    const d1 = refEdgeDirection(edges, coords, eA);
    const d2 = refEdgeDirection(edges, coords, eB);
    if (!d1 || !d2) return null;
    const n = norm(cross(d1, d2));
    return len(n) > EPS ? n : null;
  }
  if (planeRef.type === 'byEdgeUp') {
    const refId = planeRef.ref;
    const d = refEdgeDirection(edges, coords, refId);
    if (!d) return null;

    let up = { x:0, y:1, z:0 };
    const dotUp = Math.abs(d.x*up.x + d.y*up.y + d.z*up.z);
    if (dotUp > 0.99) {
        // fallback up-axis om parallellt med globalUp
        up = Math.abs(d.x) < 0.99 ? { x:1, y:0, z:0 } : { x:0, y:0, z:1 };
    }

    const n = norm(cross(d, up));
    return len(n) > EPS ? n : null;
    }
  if (planeRef.type === 'byNormal') {
    const n = planeRef.n || null;
    if (!n) return null;
    return norm(n);
  }
  return null;
}

// Hitta planeRef på nod (t.ex. tee.planeRef) eller på kanter kring nod
function findPlaneRefForNode(graph, edges, coords, nodeId){
  const n = graph.getNode?.(nodeId);
  if (n?.meta?.tee?.planeRef) return n.meta.tee.planeRef;
  // annars: försök hitta på någon incident edge
  for (const e of incidentEdgesOf(graph, nodeId)) {
    if (e?.meta?.coplanarWith) return e.meta.coplanarWith;
  }
  return null;
}

// Bestäm riktning för kant utifrån constraints (enhetsvektor i 3D)
function edgeDirectionFromConstraints(graph, edges, coords, fromNodeId, edge){
  // Absolut lås
  if (edge?.meta?.axisLock) {
    const ax = edge.meta.axisLock;
    if (ax === 'X') return v(1,0,0);
    if (ax === 'Y') return v(0,1,0);
    if (ax === 'Z') return v(0,0,1);
  }

  const meta = edge?.meta || {};
  const hasParallel = !!meta.parallelTo;
  const hasPerp     = !!meta.perpTo;
  const hasAngle    = !!meta.angleTo;

  // Hjälp: hämta plan-normal:
  const planeRef = meta.coplanarWith || findPlaneRefForNode(graph, edges, coords, fromNodeId);
  const n = planeNormalFromRef(planeRef, edges, coords);

  // Prioritet: angleTo > perpTo > parallelTo
  if (hasAngle) {
    const refId = meta.angleTo.ref;
    const deg   = meta.angleTo.deg || 0;
    const refDir = refEdgeDirection(edges, coords, refId);
    if (!refDir || !n) return null;
    const rad = deg * Math.PI / 180;
    const dir = norm(rotateAroundAxis(refDir, n, rad));
    if (fromNodeId === edge.b) return mul(dir, -1);
    return dir;
  }

  if (hasPerp) {
    const refId = meta.perpTo.ref;
    const refDir = refEdgeDirection(edges, coords, refId);
    if (!refDir || !n) return null;
    // I planet med normal n: en vektor v ⟂ refDir är cross(n, refDir)
    let dir = cross(n, refDir);
    if (nearZero(len(dir))) return null;
    dir = norm(dir);
    if (fromNodeId === edge.b) dir = mul(dir, -1);
    return dir;
  }

  if (hasParallel) {
    const refId = meta.parallelTo.ref;
    const refDir = refEdgeDirection(edges, coords, refId);
    if (!refDir) return null;
    let dir = refDir;
    if (fromNodeId === edge.b) dir = mul(dir, -1);
    return dir;
  }

  // Inga constraints vi kan använda
  return null;
}

// ──────────────────────────────────────────────────────────────
// Triangulering (två kända grannar + planeRef)
function triangulateNodeInPlane(graph, edges, coords, unknownNodeId){
  // Hitta två (eller fler) dimensionerade kanter från noden till redan placerade noder
  const inc = incidentEdgesOf(graph, unknownNodeId).filter(hasDim);
  const toPlaced = inc.filter(e => coords.has(otherOf(e, unknownNodeId)));
  if (toPlaced.length < 2) return null;

  // Hämta planRef (helst från noden, annars från någon av kanterna)
  let planeRef = findPlaneRefForNode(graph, edges, coords, unknownNodeId);
  if (!planeRef) {
    // som fallback: använd första kantens coplanarWith om finns
    for (const e of toPlaced) {
      if (e?.meta?.coplanarWith) { planeRef = e.meta.coplanarWith; break; }
    }
  }
  if (!planeRef) return null;

  const n = planeNormalFromRef(planeRef, edges, coords);
  if (!n) return null;

  // Välj det kantpar vars kända grannar är mest separerade (bättre kondition)
  let best = null;
  for (let i=0;i<toPlaced.length;i++){
    for (let j=i+1;j<toPlaced.length;j++){
      const e1 = toPlaced[i], e2 = toPlaced[j];
      const p1 = coords.get(otherOf(e1, unknownNodeId));
      const p2 = coords.get(otherOf(e2, unknownNodeId));
      const d = len(sub(p2, p1));
      if (!best || d > best.d){ best = { e1, e2, p1, p2, d }; }
    }
  }
  if (!best) return null;

  const { e1, e2, p1, p2 } = best;
  const r1 = e1.dim.valueMm;
  const r2 = e2.dim.valueMm;

  // Välj O (planets ursprung) – projektera p1 till planet
  const O = projectPointToPlane(p1, v(0,0,0), n); // plan som går genom origo med normal n

  // Projektionsdata
  const h1 = dot(sub(p1, O), n);
  const h2 = dot(sub(p2, O), n);
  const p1p = sub(p1, mul(n, h1)); // p1'
  const p2p = sub(p2, mul(n, h2)); // p2'

  // Ortonormerat baspar i planet: u (p1'→p2'), v = n×u
  let u = sub(p2p, p1p);
  const d = len(u);
  if (d <= EPS) return null;
  u = norm(u);
  let vax = cross(n, u);
  if (len(vax) <= EPS) return null;
  const v2 = norm(vax);

  // 2D-koordinater i planet
  const p1_2d = { x: dot(sub(p1p, O), u), y: dot(sub(p1p, O), v2) };
  const p2_2d = { x: dot(sub(p2p, O), u), y: dot(sub(p2p, O), v2) };

  // Justerade radier (tar hänsyn till höjd över planet)
  const r1sq = r1*r1 - h1*h1;
  const r2sq = r2*r2 - h2*h2;
  if (r1sq < -1e-6 || r2sq < -1e-6) return null; // konflikt
  const r1p = Math.sqrt(Math.max(0, r1sq));
  const r2p = Math.sqrt(Math.max(0, r2sq));

  // Cirkelsnitt i 2D
  const d2 = Math.hypot(p2_2d.x - p1_2d.x, p2_2d.y - p1_2d.y);
  if (d2 <= EPS) return null;
  if (d2 > r1p + r2p + 1e-6) return null;
  if (d2 < Math.abs(r1p - r2p) - 1e-6) return null;

  const ex = { x:(p2_2d.x - p1_2d.x)/d2, y:(p2_2d.y - p1_2d.y)/d2 };
  const a  = (r1p*r1p - r2p*r2p + d2*d2) / (2*d2);
  const h  = Math.sqrt(Math.max(0, r1p*r1p - a*a));
  const pm = { x: p1_2d.x + a*ex.x, y: p1_2d.y + a*ex.y };
  const ey = { x: -ex.y, y: ex.x };

  const candidates2D = (h <= 1e-9)
    ? [ pm ]
    : [ { x: pm.x + h*ey.x, y: pm.y + h*ey.y },
        { x: pm.x - h*ey.x, y: pm.y - h*ey.y } ];

  // Lyft tillbaka till 3D och välj deterministiskt
  const candidates3D = candidates2D.map(q => add(O, add(mul(u, q.x), mul(v2, q.y))));

  // Välj punkt via enkel heuristik: välj den med större dot((Q - p1), v2) (”uppåt” i planet),
  // annars den första. Detta är stabilt/deterministiskt för våra tester.
  let chosen = candidates3D[0];
  if (candidates3D.length === 2) {
    const s0 = dot(sub(candidates3D[0], p1), v2);
    const s1 = dot(sub(candidates3D[1], p1), v2);
    chosen = (s1 > s0) ? candidates3D[1] : candidates3D[0];
  }

  return chosen;
}

function projectPointToPlane(P, O, nUnit){
  // Projektera P till plan med normal nUnit genom O
  const w = sub(P, O);
  const dist = dot(w, nUnit);
  return sub(P, mul(nUnit, dist));
}

// ──────────────────────────────────────────────────────────────
// Huvudfunktion
export function calculateMetricData(graph){
  if (!isGraphSolvable(graph)) return null;

  const nodes = graph.allNodes();
  const edges = graph.allEdges();

  // Anchor vid origo
  const anchor = [...nodes.values()].find(n => n?.meta?.isAnchor);
  if (!anchor) return null;

  const coords = new Map();
  coords.set(anchor.id, v(0,0,0));

  // Kör i pass tills inga framsteg
  let progress = true;
  while (progress) {
    progress = false;

    // 1) Försök placera via DIREKT RIKTNING (constraints)
    for (const e of edges.values()) {
      if (!hasDim(e)) continue;
      const aPlaced = coords.has(e.a);
      const bPlaced = coords.has(e.b);
      if (aPlaced && bPlaced) continue;
      if (aPlaced === bPlaced) continue;

      const fromId = aPlaced ? e.a : e.b;
      const toId   = aPlaced ? e.b : e.a;

      const dir = edgeDirectionFromConstraints(graph, edges, coords, fromId, e);
      if (!dir) continue; // ingen riktning än

      const fromPos = coords.get(fromId);
      if (!fromPos) continue;

      const pos = add(fromPos, mul(dir, e.dim.valueMm));
      coords.set(toId, pos);
      progress = true;
    }

    // 2) Försök placera via TRIANGULERING där det behövs
    for (const nId of nodes.keys()) {
      if (coords.has(nId)) continue; // redan placerad

      const pos = triangulateNodeInPlane(graph, edges, coords, nId);
      if (!pos) continue;

      coords.set(nId, pos);
      progress = true;
    }
  }

  // Alla noder måste vara placerade för att vi ska returnera metriken
  if (coords.size !== nodes.size) return null;

  return coords;
}
