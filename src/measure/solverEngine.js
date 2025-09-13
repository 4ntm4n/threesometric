// ──────────────────────────────────────────────────────────────────────────────
// src/measure/solverEngine.js — Orchestrator för stateless engine
// ──────────────────────────────────────────────────────────────────────────────
import { listUserCenterEdgesInComponent } from './engine/graphUtil.js';
import { recomputeComponentFromScratch_READONLY } from './engine/propagate.js';
import { normalizeLocksForDiagonal_READONLY } from './engine/normalize.js';
import { autosolveDiagonal_LockTwoLatest_AdjustOldest_READONLY } from './engine/autosolve.js';

import { collectChainsInComponent } from './engine/chains/collect.js';
import { distributeChains } from './engine/chains/distribute.js';


export function solve(graph, seedEdgeId, opts = {}) {
  if (!graph || !seedEdgeId) return { nodes:new Map(), edges:new Map() };

  const solNodes = new Map();
  const solEdges = new Map();

  // 1) Grundrecompute (får in derived från metric + konflikter för user)
  recomputeComponentFromScratch_READONLY(graph, seedEdgeId, solNodes, solEdges, opts);

  // 2) Lås-normalisering på diagonaler
  const diags1 = listUserCenterEdgesInComponent(graph, seedEdgeId);
  for (const d of diags1) {
    normalizeLocksForDiagonal_READONLY(graph, d.id, solNodes, solEdges, opts);
  }

  // 3) Autosolve diagonaler (äldre kandidat justeras)
  const diags2 = listUserCenterEdgesInComponent(graph, seedEdgeId);
  for (const d of diags2) {
    recomputeComponentFromScratch_READONLY(graph, d.id, solNodes, solEdges, opts);
    autosolveDiagonal_LockTwoLatest_AdjustOldest_READONLY(graph, d.id, solNodes, solEdges, opts);
  }

  // 4) Kedjor: fördela totalMm → skriv dim per länk + stega noders metric längs spinen
  const chains = collectChainsInComponent(graph, seedEdgeId);
  distributeChains(graph, { nodes: solNodes, edges: solEdges }, chains, opts);

  // 5) Final pass: derive/validera med bevarade chain-positions (propagate bevarar kända!)
  recomputeComponentFromScratch_READONLY(graph, seedEdgeId, solNodes, solEdges, opts);

  return { nodes: solNodes, edges: solEdges };
}
