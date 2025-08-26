// ──────────────────────────────────────────────────────────────────────────────
// src/ops/slope.js
// Slope A→B på användarens center-nät:
//  • Path via endast center-edges (inga construction).
//  • Endast horisontella segment får fall: y_next = y_prev - s*horiz.
//  • Vertikaler och redan lutande segment bevarar sitt Δy (ingen extra lutning).
// ──────────────────────────────────────────────────────────────────────────────

const EPS = 1e-6;

// ——— utils: world pos / set world Y (fallbacks om graph saknar helpers)
function getNodeWorldPos(graph, nodeId) {
  if (typeof graph.getNodeWorldPos === 'function') return graph.getNodeWorldPos(nodeId);
  const n = graph.nodes?.get(nodeId);
  if (!n) return { x:0,y:0,z:0 };
  if (n.pos) return n.pos;
  const b = n.base || {x:0,y:0,z:0};
  const o = n.offset || {x:0,y:0,z:0};
  return { x:(b.x??0)+(o.x??0), y:(b.y??0)+(o.y??0), z:(b.z??0)+(o.z??0) };
}
function setNodeWorldY(graph, nodeId, yNew) {
  if (typeof graph.setNodeWorldY === 'function') { graph.setNodeWorldY(nodeId, yNew); return; }
  const n = graph.nodes?.get(nodeId); if (!n) return;
  if (n.pos) { n.pos.y = yNew; return; }
  if (!n.base) n.base = { x:0,y:0,z:0 };
  if (!n.offset) n.offset = { x:0,y:0,z:0 };
  const curY = (n.base.y ?? 0) + (n.offset.y ?? 0);
  n.offset.y = (n.offset.y ?? 0) + (yNew - curY);
}

// ——— geometri
function horizDistXZ(a, b) { const dx=b.x-a.x, dz=b.z-a.z; return Math.hypot(dx, dz); }
function isAlmostZero(v)   { return Math.abs(v) < EPS; }

// ——— grannar: endast center-edges (exkl. construction)
function* neighborsCenter(graph, nodeId) {
  const bag = graph.adj?.get(nodeId);
  if (!bag) return;
  for (const eid of bag) {
    const e = graph.edges.get(eid);
    if (!e || e.kind !== 'center') continue;
    const otherId = (e.a === nodeId) ? e.b : e.a;
    yield { edge: e, otherId };
  }
}

// ——— enkel Dijkstra (alla center-edges vikt = 1)
function pathCenterAB(graph, aId, bId) {
  if (!graph?.nodes?.size) return null;
  const dist = new Map();
  const prev = new Map();
  const unvisited = new Set(graph.nodes.keys());
  for (const id of unvisited) dist.set(id, Infinity);
  dist.set(aId, 0);

  while (unvisited.size) {
    let u = null, best = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id);
      if (d < best) { best = d; u = id; }
    }
    if (u == null) break;
    unvisited.delete(u);
    if (u === bId) break;

    for (const { otherId } of neighborsCenter(graph, u)) {
      if (!unvisited.has(otherId)) continue;
      const alt = dist.get(u) + 1;
      if (alt < dist.get(otherId)) {
        dist.set(otherId, alt);
        prev.set(otherId, u);
      }
    }
  }
  if (!prev.has(bId) && aId !== bId) return null;

  // bygg path bakifrån
  const path = [bId];
  for (let cur = bId; cur !== aId; ) {
    const p = prev.get(cur);
    if (p == null) return aId === bId ? [aId] : null;
    path.push(p);
    cur = p;
  }
  path.reverse();
  return path;
}

/**
 * Preview av slope längs A→B:
 *  • Starta på y_A.
 *  • För varje path-segment:
 *      - Δy_orig = y(b)_orig - y(a)_orig
 *      - L_h = XZ-längd(a,b)
 *      - Om |Δy_orig| < EPS  (horisontellt): y(b)* = y(a)* - s * L_h
 *        Annars (vertikal/diagonal):         y(b)* = y(a)* + Δy_orig   (bevara höjdskillnaden)
 *
 * returnerar { ok, reason?, path, yTargetByNode: Map<nodeId,y>, affectedEdges: string[] }
 */
export function makeSlopePreviewOnPath(graph, aId, bId, s /* t.ex. 0.01 */) {
  const path = pathCenterAB(graph, aId, bId);
  if (!path) return { ok:false, reason:'no_path' };

  const aPos = getNodeWorldPos(graph, aId);
  if (!aPos) return { ok:false, reason:'bad_A' };

  const yTargetByNode = new Map();
  yTargetByNode.set(aId, aPos.y);

  for (let i = 0; i < path.length - 1; i++) {
    const idA = path[i], idB = path[i+1];
    const pA = getNodeWorldPos(graph, idA);
    const pB = getNodeWorldPos(graph, idB);

    const dyOrig = pB.y - pA.y;
    const Lh     = horizDistXZ(pA, pB);

    const yAstar = yTargetByNode.get(idA);
    const yBstar = (Math.abs(dyOrig) < EPS)
      ? (yAstar - s * Lh)           // horisontell sträcka → applicera fall
      : (yAstar + dyOrig);          // vertikal/diagonal → bevara original Δy

    yTargetByNode.set(idB, yBstar);
  }

  // berörda center-edges för uppdatering i scenen
  const affected = new Set();
  for (const nid of path) {
    const set = graph.adj?.get(nid);
    if (!set) continue;
    for (const eid of set) {
      const e = graph.edges.get(eid);
      if (e && e.kind === 'center') affected.add(eid);
    }
  }

  return { ok:true, path, yTargetByNode, affectedEdges:[...affected] };
}

// ——— commit
export function applySlopePreview(graph, preview) {
  if (!preview?.ok) return { ok:false, reason:'no_preview' };
  for (const [nid, y] of preview.yTargetByNode) setNodeWorldY(graph, nid, y);
  return { ok:true, affectedEdges: preview.affectedEdges, path: preview.path };
}
