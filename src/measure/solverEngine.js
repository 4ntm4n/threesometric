// ──────────────────────────────────────────────────────────────────────────────
// src/measure/solverEngine.js  — Orchestrator för stateless engine
// ──────────────────────────────────────────────────────────────────────────────

import { listUserCenterEdgesInComponent } from './engine/graphUtil.js';
import { recomputeComponentFromScratch_READONLY } from './engine/propagate.js';
import { normalizeLocksForDiagonal_READONLY } from './engine/normalize.js';
import { autosolveDiagonal_LockTwoLatest_AdjustOldest_READONLY } from './engine/autosolve.js';

import { collectChainsInComponent } from './engine/chains/collect.js';
import { distributeChains } from './engine/chains/distribute.js';

/**
 * Stateless huvudflöde:
 * - Propagera (READONLY)
 * - Normalisera lås kring diagonaler (READONLY)
 * - Autosolve för kvarvarande diagonaler (READONLY)
 * - Recompute för seed (stabilisera)
 * - Kedjor v1: fördela längder längs spine + positionera interna noder (READONLY)
 * - Final recompute (READONLY)
 * - Returnera solution (nodes/edges maps)
 */
export function solve(graph, seedEdgeId, opts = {}) {
  if (!graph || !seedEdgeId) return { nodes: new Map(), edges: new Map() };

  const solNodes = new Map();
  const solEdges = new Map();

  // 1) Recompute hela komponenten (READONLY)
  recomputeComponentFromScratch_READONLY(graph, seedEdgeId, solNodes, solEdges, opts);

  // 2) Lås-normalisering för usersatta diagonaler i samma komponent
  const diagsBefore = listUserCenterEdgesInComponent(graph, seedEdgeId);
  for (const d of diagsBefore) {
    normalizeLocksForDiagonal_READONLY(graph, d.id, solNodes, solEdges, opts);
  }

  // 3) Recompute + autosolve för kvarvarande user-diagonaler
  const diagsAfter = listUserCenterEdgesInComponent(graph, seedEdgeId);
  for (const d of diagsAfter) {
    recomputeComponentFromScratch_READONLY(graph, d.id, solNodes, solEdges, opts);
    autosolveDiagonal_LockTwoLatest_AdjustOldest_READONLY(graph, d.id, solNodes, solEdges, opts);
  }

  // 3.5) Stabilisering: ett extra recompute för seed efter autosolve
  recomputeComponentFromScratch_READONLY(graph, seedEdgeId, solNodes, solEdges, opts);

  // 4) Kedjor v1: fördela segment längs spine (chord) och steppa interna noder
  const chains = collectChainsInComponent(graph, seedEdgeId);
  distributeChains(graph, { nodes: solNodes, edges: solEdges }, chains, seedEdgeId);

  // 5) Final pass så derived-värden matchar nya node.metric
  recomputeComponentFromScratch_READONLY(graph, seedEdgeId, solNodes, solEdges, opts);

  return { nodes: solNodes, edges: solEdges };
}
