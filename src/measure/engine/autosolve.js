import { dominantAxis } from './math.js';
import { getEdgeDim } from './graphUtil.js';
import { findManhattanPath } from './paths.js';
import { getUserEditedAt } from './lengthUtil.js';
import { demoteOneEdge_READONLY, writeDerivedLen_READONLY } from './writers.js';
import { recomputeComponentFromScratch_READONLY } from './propagate.js';

export function autosolveDiagonal_LockTwoLatest_AdjustOldest_READONLY(graph, diagEid, solNodes, solEdges, opts = {}) {
  const eD = graph.getEdge(diagEid); if (!eD) return;
  const dimD = getEdgeDim(graph, eD.id, solEdges) || eD.dim || null;
  if (!dimD || dimD.source !== 'user') return;
  if (!(typeof dimD.valueMm === 'number' && isFinite(dimD.valueMm))) return;

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
    const aM  = solNodes.get(aId);
    const bM  = solNodes.get(bId);
    const aW  = graph.getNodeWorldPos(aId), bW = graph.getNodeWorldPos(bId);

    const dW = { x:bW.x-aW.x, y:bW.y-aW.y, z:bW.z-aW.z };
    const axis = dominantAxis(dW);

    const dM = (aM?.known && bM?.known) ? { x:bM.x-aM.x, y:bM.y-aM.y, z:bM.z-aM.z } : dW;
    const key = axis.toLowerCase();
    const sign = (Math.abs(dM[key]) > 1e-9) ? Math.sign(dM[key]) : ((Math.abs(dW[key]) > 1e-9) ? Math.sign(dW[key]) : 1);

    const stamp = getUserEditedAt(ed);
    rec.push({ type:'leg', eid, axis, sign, stamp });
    const curDim = getEdgeDim(graph, eid, solEdges) || ed.dim || null;
    candEdges.push({ eid, axis, sign, stamp, dim: curDim, idx:i });
  }

  if (!candEdges.length) return;
  opts.dumpPathAndRecency?.(graph, path, rec, { title: 'Autosolve: path + recency' });

  rec.sort((a,b)=> (b.stamp - a.stamp));
  const topTwo = new Set(rec.slice(0,2).map(x => x.eid));

  let pick = candEdges
    .filter(c => !topTwo.has(c.eid))
    .sort((a,b)=> (a.stamp - b.stamp) || a.eid.localeCompare(b.eid))[0];
  if (!pick) pick = candEdges.sort((a,b)=> (a.stamp - b.stamp) || a.eid.localeCompare(b.eid))[0];
  if (!pick) return;

  if (pick.dim?.source === 'user') {
    demoteOneEdge_READONLY(graph, pick.eid, solNodes, solEdges);
    recomputeComponentFromScratch_READONLY(graph, diagEid, solNodes, solEdges, opts);
  }

  const startM = solNodes.get(path.nodes[0]);
  const endM   = solNodes.get(path.nodes[path.nodes.length-1]);
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
    const now = getEdgeDim(graph, diagEid, solEdges) || {};
    solEdges.set(diagEid, { ...now, conflict:{ deltaMm: Math.sqrt(other2sq) - dTarget } });
    return;
  }

  const mag       = Math.sqrt(Math.max(0, reqSq));
  const signTotal = (Math.abs(curAxisTotal) > 1e-9) ? Math.sign(curAxisTotal) : (pick.sign || 1);
  const newAxisTotal = mag * signTotal;

  const idx = pick.idx;
  const segStart = solNodes.get(path.nodes[idx]);
  const segEnd   = solNodes.get(path.nodes[idx+1]);
  if (!segStart?.known || !segEnd?.known) return;

  const segDM = { x:segEnd.x - segStart.x, y:segEnd.y - segStart.y, z:segEnd.z - segStart.z };
  const oldPickSigned = segDM[key];

  const sumOthers = curAxisTotal - oldPickSigned;
  const newPickSigned = newAxisTotal - sumOthers;
  const newSegLen = Math.abs(newPickSigned);

  writeDerivedLen_READONLY(graph, pick.eid, newSegLen, solEdges);
  opts.dumpComponentAroundEdge?.(graph, diagEid, { title: 'AFTER autosolve write (READONLY)' });

  recomputeComponentFromScratch_READONLY(graph, diagEid, solNodes, solEdges, opts);
  opts.dumpComponentAroundEdge?.(graph, diagEid, { title: 'AFTER final recompute (READONLY)' });
}

export const __autosolve_ok = true;
