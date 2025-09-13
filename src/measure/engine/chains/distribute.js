// ──────────────────────────────────────────────────────────────────────────────
// chains/distribute.js — fördela totalMm över kedjesegment + placera interna noder
// ──────────────────────────────────────────────────────────────────────────────

import { getEdgeDim } from '../graphUtil.js';
import { edgeCurrentLengthFromSolOrWorld } from '../lengthUtil.js';

/**
 * @param {any} graph
 * @param {{nodes: Map, edges: Map}} solution
 * @param {Array<{ id:string, edges:string[], nodes:string[], endA:string, endB:string, totalMm:number|null, distribution:string }>} chains
 * @param {object} opts
 */
export function distributeChains(graph, solution, chains, opts = {}) {
  const solNodes = solution.nodes;
  const solEdges = solution.edges;

  for (const chain of chains) {
    const edges = Array.isArray(chain.edges) ? chain.edges.slice() : [];
    const nodes = Array.isArray(chain.nodes) ? chain.nodes.slice() : [];
    if (!edges.length || nodes.length < 2) continue;

    // 1) Försök börja på endA, annars endB (hjälper UI/recency)
    rotateOrderPreferEnds(nodes, edges, chain.endA, chain.endB);

    // 2) Tvinga ordningen att följa VÄRLDS-riktningen så att inget “flippar”
    orientOrderToWorldDirection(graph, nodes, edges);

    // 3) Bestäm totalMm (om ej given): chord mellan nodes[0] och nodes[last]
    let total = isFiniteNumber(chain.totalMm) ? chain.totalMm : null;
    if (total == null) {
      const startId = nodes[0];
      const endId   = nodes[nodes.length - 1];
      const aM = solNodes.get(startId);
      const bM = solNodes.get(endId);
      total = (aM?.known && bM?.known)
        ? dist3(aM, bM)
        : worldDistSafe(graph.getNodeWorldPos(startId), graph.getNodeWorldPos(endId));
    }
    if (!isFiniteNumber(total)) continue;

    // 4) Låsta (user) vs fria segment
    const locked = [];
    const free = [];
    for (const eid of edges) {
      const dim = getEdgeDim(graph, eid, solEdges);
      const isUser = dim?.source === 'user' && isFiniteNumber(dim?.valueMm);
      if (isUser) locked.push({ eid, val: dim.valueMm, dim });
      else free.push({ eid, dim });
    }
    const sumLocked = locked.reduce((s, x) => s + x.val, 0);
    let remainder = total - sumLocked;

    // 5) Overdraft/overflow → sätt fria=0 + konflikt, placera ändå
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
      writeNodePositionsEvenOrLocked(graph, solNodes, nodes, edges, locked, zeros, total);

      // 🔧 NYTT: håll branch-kanter i world-riktning
      adjustAdjacentLockedEdges(graph, solNodes, nodes, new Set(edges));
      continue;
    }

    // 6) Fördela remainder jämnt över fria
    const each = (free.length > 0) ? (remainder / Math.max(1, free.length)) : 0;
    const freeWithVals = free.map(f => ({ eid: f.eid, val: each }));

    // 7) Skriv derived-dim på fria
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

    // 8) Placera interna noder längs “spine”
    writeNodePositionsEvenOrLocked(graph, solNodes, nodes, edges, locked, freeWithVals, total);

    // 🔧 NYTT: efter att kedjenoder flyttats, rikta om låsta grannkanter 1-hopp utanför kedjan
    adjustAdjacentLockedEdges(graph, solNodes, nodes, new Set(edges));
  }
}

// ── Placering av noder längs "spine" mellan nodes[0] → nodes[last] ────────────
function writeNodePositionsEvenOrLocked(graph, solNodes, orderedNodes, orderedEdges, locked, freeWithVals, total) {
  // Längder per edge (default 0)
  const lengthByEdge = new Map();
  for (const { eid, val } of locked)       lengthByEdge.set(eid, clampNonNegative(val));
  for (const { eid, val } of freeWithVals) lengthByEdge.set(eid, clampNonNegative(val));
  for (const eid of orderedEdges) {
    if (!lengthByEdge.has(eid)) lengthByEdge.set(eid, 0);
  }

  // Välj start-/slut-ända
  let startId = orderedNodes[0];
  let endId   = orderedNodes[orderedNodes.length - 1];

  let startM = solNodes.get(startId);
  let endM   = solNodes.get(endId);
  const bothKnown = Boolean(startM?.known && endM?.known);

  // Om start inte känd men slut är känd → vänd så vi kan ankra på känd ände
  if (!bothKnown && !startM?.known && endM?.known) {
    reverseOrder(orderedNodes, orderedEdges);
    startId = orderedNodes[0];
    endId   = orderedNodes[orderedNodes.length - 1];
    startM  = solNodes.get(startId);
    endM    = solNodes.get(endId);
  }

  // Försök ankra start-änden på en känd nod som har *samma world-position* (t.ex. split-nod)
  if (!startM?.known) {
    const coinc = findCoincidentKnownMetricNode(graph, solNodes, startId);
    if (!coinc) {
      const coincEnd = findCoincidentKnownMetricNode(graph, solNodes, endId);
      if (coincEnd) {
        reverseOrder(orderedNodes, orderedEdges);
        startId = orderedNodes[0];
        endId   = orderedNodes[orderedNodes.length - 1];
        startM  = solNodes.get(startId);
      }
    }
  }

  // Riktning: metric-ändar om kända, annars world-chord
  let origin, dir;
  startM = solNodes.get(startId);
  endM   = solNodes.get(endId);
  const bothKnownNow = Boolean(startM?.known && endM?.known);

  if (bothKnownNow) {
    origin = startM;
    dir = unitVecSafe({ x:endM.x - startM.x, y:endM.y - startM.y, z:endM.z - startM.z });
  } else {
    origin = startM?.known
      ? startM
      : (findCoincidentKnownMetricNode(graph, solNodes, startId)?.metric ??
         { x:0, y:0, z:0, known:true });

    const aW = graph.getNodeWorldPos(startId);
    const bW = graph.getNodeWorldPos(endId);
    const chord = { x:(bW?.x ?? 0) - (aW?.x ?? 0), y:(bW?.y ?? 0) - (aW?.y ?? 0), z:(bW?.z ?? 0) - (aW?.z ?? 0) };
    dir = unitVecSafe(chord);

    const curStart = solNodes.get(startId);
    if (!curStart?.known) solNodes.set(startId, origin);
  }

  // Stega
  let cur = { x:origin.x, y:origin.y, z:origin.z };
  solNodes.set(orderedNodes[0], { ...cur, known:true });

  for (let i=0; i<orderedEdges.length; i++) {
    const eid = orderedEdges[i];
    let len = lengthByEdge.get(eid);
    if (!isFiniteNumber(len)) {
      len = clampNonNegative(edgeCurrentLengthFromSolOrWorld(graph, eid, solNodes));
    }
    cur = { x: cur.x + dir.x * len, y: cur.y + dir.y * len, z: cur.z + dir.z * len };
    solNodes.set(orderedNodes[i+1], { ...cur, known:true });
  }

  // Snappa bara om båda ändar inte redan var kända (flytta inte “låsta” endpoints)
  if (!bothKnownNow && isFiniteNumber(total)) {
    const endSnap = {
      x: origin.x + dir.x * total,
      y: origin.y + dir.y * total,
      z: origin.z + dir.z * total,
      known: true
    };
    solNodes.set(endId, endSnap);
    const lastId = orderedNodes[orderedNodes.length - 1];
    if (lastId === endId) solNodes.set(lastId, endSnap);
  }
}

// ── 1-hop justering av låsta grannkanter så deras riktning följer WORLD ───────
function adjustAdjacentLockedEdges(graph, solNodes, chainNodeIds, chainEdgeSet) {
  for (const nid of chainNodeIds) {
    const anchor = solNodes.get(nid);
    if (!anchor?.known) continue;

    const adjEdgeIds = edgesOfNode(graph, nid);
    for (const eid of adjEdgeIds) {
      if (chainEdgeSet.has(eid)) continue; // hoppa över kedjans egna segment

      const e = graph.getEdge(eid);
      if (!e) continue;
      const otherId = (e.a === nid) ? e.b : e.a;

      // Läs dimension (user-lås)
      const dim = graph.getEdgeDimension ? graph.getEdgeDimension(eid) : null;
      const valMm = isFiniteNumber(dim?.valueMm) ? dim.valueMm : null;
      const isUser = (dim?.source === 'user') && (valMm != null);
      if (!isUser) continue;

      const otherM = solNodes.get(otherId);
      if (otherM?.known) continue; // båda ändar “kända” → rör ej här

      // world-riktning från anchor → other
      const aW = graph.getNodeWorldPos(nid);
      const bW = graph.getNodeWorldPos(otherId);
      const dirW = unitVecSafe({
        x: (bW?.x ?? 0) - (aW?.x ?? 0),
        y: (bW?.y ?? 0) - (aW?.y ?? 0),
        z: (bW?.z ?? 0) - (aW?.z ?? 0),
      });

      // sätt other enligt world-riktning * user-längden
      solNodes.set(otherId, {
        x: anchor.x + dirW.x * valMm,
        y: anchor.y + dirW.y * valMm,
        z: anchor.z + dirW.z * valMm,
        known: true
      });
    }
  }
}

// Försök få edge-lista för en nod, med flera API-varianter som fallback
function edgesOfNode(graph, nodeId) {
  if (typeof graph.getNodeEdges === 'function') return graph.getNodeEdges(nodeId);
  if (typeof graph.getEdgesAround === 'function') return graph.getEdgesAround(nodeId);
  if (typeof graph.getEdgesForNode === 'function') return graph.getEdgesForNode(nodeId);
  if (typeof graph.forEachEdge === 'function') {
    const out = [];
    graph.forEachEdge((id, e) => { if (e?.a === nodeId || e?.b === nodeId) out.push(id); });
    return out;
  }
  if (typeof graph.getAllEdgeIds === 'function') {
    const ids = graph.getAllEdgeIds();
    return ids.filter(id => {
      const e = graph.getEdge(id);
      return e && (e.a === nodeId || e.b === nodeId);
    });
  }
  // som sista utväg: inget
  return [];
}

// ── hjälpare för ordning/orientering ──────────────────────────────────────────

function rotateOrderPreferEnds(nodes, edges, endA, endB) {
  const idxA = nodes.indexOf(endA);
  if (idxA > 0) { rotate(nodes, edges, idxA); return; }
  if (idxA === 0) return;
  const idxB = nodes.indexOf(endB);
  if (idxB > 0) { rotate(nodes, edges, idxB); return; }
}

function orientOrderToWorldDirection(graph, nodes, edges) {
  if (nodes.length < 2 || edges.length < 1) return;

  const ref = averageWorldDirForEdges(graph, edges);
  const refLen = len(ref);
  if (refLen <= 1e-9) return;

  const aW = graph.getNodeWorldPos(nodes[0]);
  const bW = graph.getNodeWorldPos(nodes[nodes.length - 1]);
  if (!aW || !bW) return;

  const chord = { x: bW.x - aW.x, y: bW.y - aW.y, z: bW.z - aW.z };
  const dot = chord.x * ref.x + chord.y * ref.y + chord.z * ref.z;
  if (dot < 0) reverseOrder(nodes, edges);
}

function averageWorldDirForEdges(graph, edges) {
  const acc = { x:0, y:0, z:0 };
  let any = false;
  for (const eid of edges) {
    const e = graph.getEdge(eid);
    if (!e) continue;
    const a = graph.getNodeWorldPos(e.a);
    const b = graph.getNodeWorldPos(e.b);
    if (!a || !b) continue;
    acc.x += (b.x - a.x);
    acc.y += (b.y - a.y);
    acc.z += (b.z - a.z);
    any = true;
  }
  if (!any) return { x:0, y:0, z:0 };
  const L = len(acc) || 1;
  return { x: acc.x / L, y: acc.y / L, z: acc.z / L };
}

function findCoincidentKnownMetricNode(graph, solNodes, nodeId, eps = 1e-4) {
  const w = graph.getNodeWorldPos(nodeId);
  if (!w) return null;
  for (const [id, metric] of solNodes) {
    if (!metric?.known) continue;
    const w2 = graph.getNodeWorldPos(id);
    if (!w2) continue;
    if (Math.abs((w2.x||0)-(w.x||0)) <= eps &&
        Math.abs((w2.y||0)-(w.y||0)) <= eps &&
        Math.abs((w2.z||0)-(w.z||0)) <= eps) {
      return { id, metric };
    }
  }
  return null;
}

// Roterar nodes/edges så att nodes[offset] blir först
function rotate(nodes, edges, offset) {
  const n = nodes.length;
  if (!n || offset % n === 0) return;
  const k = ((offset % n) + n) % n;
  const nodesRot = nodes.slice(k).concat(nodes.slice(0, k));
  const edgesRot = edges.slice(k).concat(edges.slice(0, k));
  nodes.length = 0; nodes.push(...nodesRot);
  edges.length = 0; edges.push(...edgesRot);
}

// Vänd ordningen (nodes[0] ↔ nodes[last]) och edges i samma riktning
function reverseOrder(nodes, edges) {
  nodes.reverse();
  edges.reverse();
}

// ── små hjälpare ──────────────────────────────────────────────────────────────

function isFiniteNumber(x){ return typeof x === 'number' && isFinite(x); }
function clampNonNegative(x){ return isFiniteNumber(x) && x >= 0 ? x : 0; }

function dist3(a,b){ return Math.hypot((b.x||0)-(a.x||0), (b.y||0)-(a.y||0), (b.z||0)-(a.z||0)); }
function worldDistSafe(a,b){
  if (!a || !b) return 0;
  return Math.hypot((b.x||0)-(a.x||0), (b.y||0)-(a.y||0), (b.z||0)-(a.z||0));
}

function len(v){ return Math.hypot(v.x||0, v.y||0, v.z||0); }
function unitVecSafe(v){
  const L = len(v);
  if (L <= 1e-12) return { x:1, y:0, z:0 }; // godtycklig axel om chord=0
  return { x:v.x/L, y:v.y/L, z:v.z/L };
}
