// ──────────────────────────────────────────────────────────────────────────────
// src/measure/engine/propagate.js
// READONLY-recompute: bevarar redan kända solNodes och skriver endast in nya
// ──────────────────────────────────────────────────────────────────────────────
import {
  collectComponentFromEdge,
  findWorldOriginNode,
  hasConstructionPathBetween,
  edgeUnitDirWorld,
  getEdgeDim,
} from './graphUtil.js';

const TOL = 0.1; // mm
const validNumber = (x)=> (typeof x === 'number' && isFinite(x)) ? x : null;
const dist3 = (a,b)=> Math.hypot((b.x||0)-(a.x||0), (b.y||0)-(a.y||0), (b.z||0)-(a.z||0));

export function recomputeComponentFromScratch_READONLY(graph, edgeId, solNodes, solEdges, opts = {}) {
  const e0 = graph.getEdge(edgeId); if (!e0) return;

  const { nodes: compNodes, edges: compEdges } = collectComponentFromEdge(graph, edgeId);
  if (!compNodes.length) return;

  // 1) Initiera endast de noder som INTE redan finns i solNodes (bevara chain-positions!)
  for (const nid of compNodes) {
    if (!solNodes.has(nid)) solNodes.set(nid, { x:0, y:0, z:0, known:false });
  }

  // 2) Origin: seedas ENDAST om inga kända noder redan finns i komponenten
  const anyKnown = compNodes.some(nid => solNodes.get(nid)?.known);
  if (!anyKnown) {
    const originId = findWorldOriginNode(graph, compNodes) ?? compNodes[0];
    solNodes.set(originId, { x:0, y:0, z:0, known:true });
  }

  const allEdges = compEdges.map(eid => graph.getEdge(eid)).filter(Boolean);

  // 3) Propagering
  let changed = true, guard = 0;
  while (changed && guard < 3 * allEdges.length + 10) {
    changed = false; guard++;

    // A) construction
    for (const ed of allEdges) {
      if (ed.kind !== 'construction') continue;
      const dim = getEdgeDim(graph, ed.id, solEdges);
      const val = validNumber(dim?.valueMm); if (val == null) continue;

      const mA = solNodes.get(ed.a), mB = solNodes.get(ed.b);
      const dir = edgeUnitDirWorld(graph, ed);
      if (mA?.known && !mB?.known) {
        solNodes.set(ed.b, { x:mA.x+dir.x*val, y:mA.y+dir.y*val, z:mA.z+dir.z*val, known:true });
        changed = true;
      } else if (!mA?.known && mB?.known) {
        solNodes.set(ed.a, { x:mB.x-dir.x*val, y:mB.y-dir.y*val, z:mB.z-dir.z*val, known:true });
        changed = true;
      }
    }

    // B) center (endast user, ej diagonaler)
    for (const ed of allEdges) {
      if (ed.kind !== 'center') continue;
      const dim = getEdgeDim(graph, ed.id, solEdges);
      if ((dim?.source || null) !== 'user') continue;
      if (hasConstructionPathBetween(graph, ed.a, ed.b)) continue; // diagonal → driver inte

      const val = validNumber(dim?.valueMm); if (val == null) continue;

      const mA = solNodes.get(ed.a), mB = solNodes.get(ed.b);
      const dir = edgeUnitDirWorld(graph, ed);
      if (mA?.known && !mB?.known) {
        solNodes.set(ed.b, { x:mA.x+dir.x*val, y:mA.y+dir.y*val, z:mA.z+dir.z*val, known:true });
        changed = true;
      } else if (!mA?.known && mB?.known) {
        solNodes.set(ed.a, { x:mB.x-dir.x*val, y:mB.y-dir.y*val, z:mB.z-dir.z*val, known:true });
        changed = true;
      }
    }
  }

  // 4) Derive/validera dimensioner
  for (const ed of allEdges) {
    const aM = solNodes.get(ed.a);
    const bM = solNodes.get(ed.b);
    if (!aM?.known || !bM?.known) continue;

    const d = dist3(aM, bM);
    const dim = getEdgeDim(graph, ed.id, solEdges) || null;
    const isUser = dim?.source === 'user';

    if (isUser) {
      const delta = Math.abs((dim?.valueMm ?? 0) - d);
      const next = { ...dim, conflict: (delta > TOL) ? { deltaMm: delta } : null };
      solEdges.set(ed.id, next);
    } else {
      solEdges.set(ed.id, {
        valueMm: d,
        mode: dim?.mode || 'aligned',
        label: dim?.label ?? null,
        source: 'derived',
        derivedFrom: 'metric',
        conflict: null
      });
    }
  }

  opts.dumpComponentAroundEdge?.(graph, edgeId, { title: 'AFTER recompute (READONLY, preserve-known)' });
}
