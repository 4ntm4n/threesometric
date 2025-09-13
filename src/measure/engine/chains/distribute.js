// ──────────────────────────────────────────────────────────────────────────────
// chains/distribute.js
// ──────────────────────────────────────────────────────────────────────────────

import { getEdgeDim } from '../graphUtil.js';
import { edgeCurrentLengthFromSolOrWorld } from '../lengthUtil.js';

export function distributeChains(graph, solution, chains, opts = {}) {
  const solNodes = solution.nodes;
  const solEdges = solution.edges;

  for (const chain of chains) {
    const edges = Array.isArray(chain.edges) ? chain.edges.slice() : [];
    const nodes = Array.isArray(chain.nodes) ? chain.nodes.slice() : [];
    if (!edges.length || nodes.length < 2) continue;

    // ── NYTT: Läs kanoniska ändnoder från meta om de finns ────────────────
    let canonicalEndA = chain.endA;
    let canonicalEndB = chain.endB;
    for (const eid of edges) {
      const meta = graph.getEdgeMeta?.(eid);
      const cm = meta?.chain;
      if (cm?.endA && cm?.endB) {
        canonicalEndA = cm.endA;
        canonicalEndB = cm.endB;
        break;
      }
    }
    // Bygg ordning via adjacency med kända ändnoder
    const { orderedNodes, orderedEdges } = orderChainFromEnds(graph, edges, canonicalEndA, canonicalEndB);
    if (!orderedEdges.length || orderedNodes.length < 2) continue;

    // 1) totalMm
    let total = isFiniteNumber(chain.totalMm) ? chain.totalMm : null;
    if (total == null) {
      const aW = graph.getNodeWorldPos(canonicalEndA);
      const bW = graph.getNodeWorldPos(canonicalEndB);
      if (aW && bW) {
        total = worldDistSafe(aW, bW);
      } else {
        const aM = solNodes.get(canonicalEndA);
        const bM = solNodes.get(canonicalEndB);
        total = (aM?.known && bM?.known) ? dist3(aM, bM) : 0;
      }
    }
    if (!isFiniteNumber(total)) continue;

    // 2) låsta vs fria
    const locked = [];
    const free = [];
    for (const eid of orderedEdges) {
      const dim = getEdgeDim(graph, eid, solEdges);
      const isUser = dim?.source === 'user' && isFiniteNumber(dim?.valueMm);
      if (isUser) locked.push({ eid, val: dim.valueMm, dim });
      else free.push({ eid, dim });
    }
    const sumLocked = locked.reduce((s, x) => s + x.val, 0);
    let remainder = total - sumLocked;

    // 3) overdraft
    if (remainder < -1e-9) {
      for (const { eid, dim } of free) {
        solEdges.set(eid, {
          valueMm: 0,
          mode: dim?.mode || 'aligned',
          label: dim?.label ?? null,
          source: 'derived',
          derivedFrom: { kind:'chain', reason:'overflow', chainId: chain.id },
          conflict: { kind:'chain_overflow', overflowMm: Math.abs(remainder) }
        });
      }
      const zeros = free.map(f => ({ eid: f.eid, val: 0 }));
      writeNodePositionsEvenOrLocked(graph, solNodes, orderedNodes, orderedEdges, locked, zeros, { id: chain.id, endA: canonicalEndA, endB: canonicalEndB }, total);
      continue;
    }

    // 4) jämn fördelning
    const each = (free.length > 0) ? (remainder / free.length) : 0;
    const freeWithVals = free.map(f => ({ eid: f.eid, val: each }));

    // 5) skriv dim
    for (const { eid, dim } of free) {
      solEdges.set(eid, {
        valueMm: each,
        mode: dim?.mode || 'aligned',
        label: dim?.label ?? null,
        source: 'derived',
        derivedFrom: { kind:'chain', chainId: chain.id },
        conflict: null
      });
    }

    // 6) placera noder
    writeNodePositionsEvenOrLocked(graph, solNodes, orderedNodes, orderedEdges, locked, freeWithVals, { id: chain.id, endA: canonicalEndA, endB: canonicalEndB }, total);
  }
}

// Bygger korrekt ordning från givna ändnoder
function orderChainFromEnds(graph, edgeIds, endA, endB) {
  // adjacency: nodeId -> [{eid, other}]
  const adj = new Map();
  const nodesInChain = new Set();
  for (const eid of edgeIds) {
    const e = graph.getEdge(eid);
    if (!e) continue;
    nodesInChain.add(e.a); nodesInChain.add(e.b);
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push({ eid, other: e.b });
    adj.get(e.b).push({ eid, other: e.a });
  }

  // Välj start/slut: om endA/endB saknas, hitta degree-1 noder
  let start = endA, goal = endB;
  if (!start || !goal) {
    const ends = [];
    for (const nid of nodesInChain) {
      const deg = (adj.get(nid) || []).length;
      if (deg === 1) ends.push(nid);
    }
    if (ends.length >= 2) {
      start = start || ends[0];
      goal  = goal  || ends[1];
    } else {
      // fallback: ta första bästa
      start = start || [...nodesInChain][0];
      goal  = goal  || [...nodesInChain][nodesInChain.size - 1];
    }
  }

  const orderedNodes = [];
  const orderedEdges = [];
  const visitedE = new Set();
  let cur = start;
  orderedNodes.push(cur);

  while (cur !== goal && orderedEdges.length < edgeIds.length) {
    const list = adj.get(cur) || [];
    const next = list.find(x => !visitedE.has(x.eid));
    if (!next) break;
    visitedE.add(next.eid);
    orderedEdges.push(next.eid);
    cur = next.other;
    orderedNodes.push(cur);
  }

  // Om vi inte landade på goal, prova reverse:
  if (orderedNodes[orderedNodes.length - 1] !== goal) {
    orderedNodes.reverse();
    orderedEdges.reverse();
  }

  return { orderedNodes, orderedEdges };
}

// Placering längs world-chord (stabil medan du ritar)
function writeNodePositionsEvenOrLocked(graph, solNodes, orderedNodes, orderedEdges, locked, freeWithVals, chain, total) {
  const lengthByEdge = new Map();
  for (const { eid, val } of locked)       lengthByEdge.set(eid, clampNonNegative(val));
  for (const { eid, val } of freeWithVals) lengthByEdge.set(eid, clampNonNegative(val));
  for (const eid of orderedEdges) if (!lengthByEdge.has(eid)) lengthByEdge.set(eid, 0);

  const aW = graph.getNodeWorldPos(chain.endA);
  const bW = graph.getNodeWorldPos(chain.endB);
  let dir = { x:0, y:0, z:1 }; // fallback
  if (aW && bW) {
    dir = unitVecSafe({ x:bW.x - aW.x, y:bW.y - aW.y, z:bW.z - aW.z });
  } else {
    const aM = solNodes.get(chain.endA);
    const bM = solNodes.get(chain.endB);
    if (aM?.known && bM?.known) {
      dir = unitVecSafe({ x:bM.x - aM.x, y:bM.y - aM.y, z:bM.z - aM.z });
    }
  }

  // origin = endA (metric om känt, annars 0,0,0)
  const aM = solNodes.get(chain.endA);
  const origin = aM?.known ? aM : { x:0, y:0, z:0, known:true };
  solNodes.set(orderedNodes[0], { ...origin, known:true });

  let cur = { x:origin.x, y:origin.y, z:origin.z };
  for (let i=0; i<orderedEdges.length; i++) {
    const eid = orderedEdges[i];
    let len = lengthByEdge.get(eid);
    if (!isFiniteNumber(len)) {
      len = clampNonNegative(edgeCurrentLengthFromSolOrWorld(graph, eid, solNodes));
    }
    cur = { x: cur.x + dir.x*len, y: cur.y + dir.y*len, z: cur.z + dir.z*len };
    solNodes.set(orderedNodes[i+1], { ...cur, known:true });
  }

  if (isFiniteNumber(total)) {
    const endSnap = {
      x: origin.x + dir.x * total,
      y: origin.y + dir.y * total,
      z: origin.z + dir.z * total,
      known: true
    };
    solNodes.set(chain.endB, endSnap);
    const lastId = orderedNodes[orderedNodes.length - 1];
    if (lastId === chain.endB) solNodes.set(lastId, endSnap);
  }
}

// helpers
function isFiniteNumber(x){ return typeof x === 'number' && isFinite(x); }
function clampNonNegative(x){ return isFiniteNumber(x) && x >= 0 ? x : 0; }

function dist3(a,b){ return Math.hypot((b.x||0)-(a.x||0), (b.y||0)-(a.y||0), (b.z||0)-(a.z||0)); }
function worldDistSafe(a,b){ if (!a || !b) return 0; return Math.hypot((b.x||0)-(a.x||0), (b.y||0)-(a.y||0), (b.z||0)-(a.z||0)); }

function len(v){ return Math.hypot(v.x||0, v.y||0, v.z||0); }
function unitVecSafe(v){ const L = len(v); return L > 1e-12 ? { x:v.x/L, y:v.y/L, z:v.z/L } : { x:1, y:0, z:0 }; }
