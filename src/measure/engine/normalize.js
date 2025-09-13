import { dominantAxis } from './math.js';
import { findManhattanPath } from './paths.js';
import { getUserEditedAt } from './lengthUtil.js';
import { demoteOneEdge_READONLY } from './writers.js';
import { getEdgeDim } from './graphUtil.js';
import { recomputeComponentFromScratch_READONLY } from './propagate.js';

export function normalizeLocksForDiagonal_READONLY(graph, diagEid, solNodes, solEdges, opts = {}) {
  const eD = graph.getEdge(diagEid); if (!eD || eD.kind !== 'center') return;
  const dimD = getEdgeDim(graph, eD.id, solEdges) || eD.dim || null;
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
      dim: getEdgeDim(graph, eid, solEdges) || ed.dim || null,
    });
  }
  const k = Math.max(1, axesUsed.size);

  const candidates = [
    { type:'diag', eid:eD.id, axis:'*', stamp:getUserEditedAt(eD), dim:dimD },
    ...legs
  ].sort((a,b)=> (b.stamp - a.stamp) || a.eid.localeCompare(b.eid));

  const keep = new Set(candidates.slice(0, k).map(c => c.eid));

  let demotedAny = false;
  for (const c of candidates) {
    if (!keep.has(c.eid) && c.dim?.source === 'user') {
      demoteOneEdge_READONLY(graph, c.eid, solNodes, solEdges);
      demotedAny = true;
    }
  }

  if (demotedAny) {
    recomputeComponentFromScratch_READONLY(graph, diagEid, solNodes, solEdges, opts);
  }
}

// liten no-op export för sanity check i nätverkspanelen
export const __normalize_ok = true;
