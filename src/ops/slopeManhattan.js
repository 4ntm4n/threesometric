// ──────────────────────────────────────────────────────────────────────────────
// src/ops/slope.js
// Manhattan slope A→B using axis-aligned edges (center + construction).
// • Traverse only orthogonal edges (X, Y, or Z). Diagonals are ignored.
// • Apply slope only on horizontal (XZ) segments: y_next = y_prev - s * horizLen.
// • Preserve risers and already-tilted segments: y_next = y_prev + Δy_orig.
// • Update all center edges attached to any node in the path.
// ──────────────────────────────────────────────────────────────────────────────

const EPS = 1e-6;

// ---- world pos helpers (works with pos or base+offset)
function getNodeWorldPos(graph, nodeId) {
  if (typeof graph.getNodeWorldPos === 'function') return graph.getNodeWorldPos(nodeId);
  const n = graph.nodes?.get(nodeId);
  if (!n) return { x: 0, y: 0, z: 0 };
  if (n.pos) return n.pos;
  const b = n.base || { x:0, y:0, z:0 };
  const o = n.offset || { x:0, y:0, z:0 };
  return { x:(b.x??0)+(o.x??0), y:(b.y??0)+(o.y??0), z:(b.z??0)+(o.z??0) };
}
function setNodeWorldY(graph, nodeId, yNew) {
  if (typeof graph.setNodeWorldY === 'function') { graph.setNodeWorldY(nodeId, yNew); return; }
  const n = graph.nodes?.get(nodeId); if (!n) return;
  if (n.pos) { n.pos.y = yNew; return; }
  if (!n.base) n.base = { x:0, y:0, z:0 };
  if (!n.offset) n.offset = { x:0, y:0, z:0 };
  const curY = (n.base.y ?? 0) + (n.offset.y ?? 0);
  n.offset.y = (n.offset.y ?? 0) + (yNew - curY);
}

// ---- geometry
function horizLenXZ(a, b) { const dx=b.x-a.x, dz=b.z-a.z; return Math.hypot(dx, dz); }
function isAxisAligned(a, b) {
  const dx = Math.abs(b.x - a.x) > EPS;
  const dy = Math.abs(b.y - a.y) > EPS;
  const dz = Math.abs(b.z - a.z) > EPS;
  // exactly one axis changes
  return (dx ? 1:0) + (dy ? 1:0) + (dz ? 1:0) === 1;
}
function isHorizontal(a, b) {
  return Math.abs(b.y - a.y) < EPS && (Math.abs(b.x - a.x) > EPS || Math.abs(b.z - a.z) > EPS);
}

// ---- neighbors restricted to axis-aligned edges (center + construction)
function* neighborsAxisAligned(graph, nodeId) {
  const bag = graph.adj?.get(nodeId);
  if (!bag) return;
  for (const eid of bag) {
    const e = graph.edges.get(eid);
    if (!e) continue;
    // accept both center and construction for traversal (diagonals excluded below)
    if (e.kind !== 'center' && e.kind !== 'construction') continue;
    const otherId = (e.a === nodeId) ? e.b : e.a;
    const pA = getNodeWorldPos(graph, nodeId);
    const pB = getNodeWorldPos(graph, otherId);
    if (!isAxisAligned(pA, pB)) continue; // skip diagonals
    yield { edge: e, otherId };
  }
}

// ---- BFS (uniform cost) across axis-aligned edges
function manhattanPathAB(graph, aId, bId) {
  if (!graph?.nodes?.size) return null;
  const prev = new Map();
  const q = [aId];
  const seen = new Set([aId]);

  while (q.length) {
    const u = q.shift();
    if (u === bId) break;
    for (const { otherId } of neighborsAxisAligned(graph, u)) {
      if (seen.has(otherId)) continue;
      seen.add(otherId);
      prev.set(otherId, u);
      q.push(otherId);
    }
  }
  if (!seen.has(bId) && aId !== bId) return null;

  // rebuild path
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
 * Make slope preview along Manhattan path:
 *  - Start at y_A (A locked).
 *  - For each segment:
 *      if horizontal (Δy≈0): y_next = y_prev - s * horizLenXZ
 *      else (vertical):      y_next = y_prev + (yBorig - yAorig)  // preserve riser
 *
 * Returns { ok, reason?, path, yTargetByNode: Map<nodeId,y>, affectedEdges: string[] }
 */
export function makeSlopePreviewOnPath(graph, aId, bId, s /* e.g. 0.01 */) {
  const path = manhattanPathAB(graph, aId, bId);
  if (!path) return { ok:false, reason:'no_manhattan_path' };

  const yTargetByNode = new Map();
  const pA0 = getNodeWorldPos(graph, aId);
  yTargetByNode.set(aId, pA0.y);

  // walk path
  for (let i=0; i<path.length-1; i++) {
    const id0 = path[i], id1 = path[i+1];
    const p0  = getNodeWorldPos(graph, id0);
    const p1  = getNodeWorldPos(graph, id1);
    const y0s = yTargetByNode.get(id0);

    let y1s;
    if (isHorizontal(p0, p1)) {
      const Lh = horizLenXZ(p0, p1);
      y1s = y0s - s * Lh;
    } else {
      // vertical step: preserve original Δy
      const dyOrig = p1.y - p0.y;
      y1s = y0s + dyOrig;
    }
    yTargetByNode.set(id1, y1s);
  }

  // edges to update (all center edges connected to any path node)
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

/** Commit preview to graph (only Y) */
export function applySlopePreview(graph, preview) {
  if (!preview?.ok) return { ok:false, reason:'no_preview' };
  for (const [nid, y] of preview.yTargetByNode) setNodeWorldY(graph, nid, y);
  return { ok:true, affectedEdges: preview.affectedEdges, path: preview.path };
}
