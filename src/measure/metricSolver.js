// ──────────────────────────────────────────────────────────────────────────────
// src/measure/metricSolver.js
// Tunn orkestratör som delegerar till solverEngine (Phase-1 refaktor).
// ──────────────────────────────────────────────────────────────────────────────

import { dumpComponentAroundEdge, dumpPathAndRecency } from '../debug/metricTrace.js';
import {
  recomputeComponentFromScratch as recompute$,
  normalizeLocksForDiagonal     as normalize$,
  autosolveDiagonal_LockTwoLatest_AdjustOldest as autosolve$,
  listUserCenterEdgesInComponent as listUserCenters$
} from './solverEngine.js';

const TRACE = true;
const DEBUG = false;
const log  = (...a)=>{ if (DEBUG) console.log('[metric]', ...a); };

let gRef = null;
let inBatch = false;

// Publikt API
export function init({ graph }) {
  gRef = graph;

  graph.onEdgeDimensionChanged?.((eid) => {
    if (inBatch) return;
    const g = gRef; const changed = g?.getEdge(eid); if (!changed) return;

    // injicera en "säker" setter (hanterar inBatch)
    const setDim = (edgeId, dim, opts) => { inBatch = true; g.setEdgeDimension(edgeId, dim, opts); inBatch = false; };
    const dbg = { dumpComponentAroundEdge, dumpPathAndRecency };

    // 1) Recompute hela komponenten
    recompute$(g, eid, setDim, dbg);

    // 2) Normalisera lås runt alla usersatta diagonaler i samma komponent
    const diagsBefore = listUserCenters$(g, eid);
    if (!diagsBefore.length) return;
    for (const d of diagsBefore) normalize$(g, d.id, setDim, dbg);

    // 3) Recompute + autosolve för kvarvarande user-diagonaler
    const diagsAfter = listUserCenters$(g, eid);
    for (const d of diagsAfter) {
      recompute$(g, d.id, setDim, dbg);
      autosolve$(g, d.id, setDim, dbg);
    }
  });

  log('metric solver orchestrator ready (Phase-1: external engine)');
}

// (alla beräkningsfunktioner ligger i src/measure/solverEngine.js)
