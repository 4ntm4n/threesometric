// ──────────────────────────────────────────────────────────────────────────────
// chains/collect.js — hitta och ordna kedjor i en komponent
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Samlar kedjor (groupade via edge.meta.chain.id) inom samma komponent som seedEdgeId.
 * Returnerar en lista med { id, edges, nodes, endA, endB, totalMm, distribution }.
 */
export function collectChainsInComponent(graph, seedEdgeId) {
  const { nodes: compNodes, edges: compEdges } = collectComponentFromEdge(graph, seedEdgeId);
  if (!compEdges.length) return [];

  // 1) gruppera alla kanter i komponenten som har meta.chain.id
  const byId = new Map(); // id -> { edges:Set, nodes:Set }
  for (const eid of compEdges) {
    const e = graph.getEdge(eid);
    const cid = e?.meta?.chain?.id || null;
    if (!cid) continue;
    let g = byId.get(cid);
    if (!g) { g = { edges: new Set(), nodes: new Set() }; byId.set(cid, g); }
    g.edges.add(eid);
    g.nodes.add(e.a); g.nodes.add(e.b);
  }
  if (!byId.size) return [];

  // 2) Bygg adjacency per kedja + hitta ändnoder
  const out = [];
  for (const [cid, group] of byId) {
    const edges = [...group.edges];
    const nodes = [...group.nodes];
    if (!edges.length || nodes.length < 2) continue;

    const adj = new Map(); // nid -> Set(neighbors)
    const pairToEdge = new Map(); // "a|b" sorterat -> eid
    for (const eid of edges) {
      const e = graph.getEdge(eid);
      if (!e) continue;
      if (!adj.has(e.a)) adj.set(e.a, new Set());
      if (!adj.has(e.b)) adj.set(e.b, new Set());
      adj.get(e.a).add(e.b);
      adj.get(e.b).add(e.a);
      const key = keyForPair(e.a, e.b);
      pairToEdge.set(key, eid);
    }

    // Hitta ändnoder (grad=1). Om inga (loop), välj två längst isär i world.
    let ends = nodes.filter(n => (adj.get(n)?.size || 0) === 1);
    let endA = null, endB = null;
    if (ends.length >= 2) {
      [endA, endB] = [ends[0], ends[1]];
    } else {
      // loop: plocka två längst isär i world
      let best = { d2: -1, a: null, b: null };
      for (let i=0;i<nodes.length;i++){
        const pi = graph.getNodeWorldPos(nodes[i]);
        for (let j=i+1;j<nodes.length;j++){
          const pj = graph.getNodeWorldPos(nodes[j]);
          const dx = pj.x-pi.x, dy = pj.y-pi.y, dz = pj.z-pi.z;
          const d2 = dx*dx+dy*dy+dz*dz;
          if (d2 > best.d2) best = { d2, a: nodes[i], b: nodes[j] };
        }
      }
      endA = best.a; endB = best.b;
      if (!endA || !endB) continue;
    }

    // 3) Ordna noder/kanter från endA -> endB (enkel väg)
    const orderedNodes = orderNodesAlongChain(adj, endA, endB, edges.length);
    if (!orderedNodes || orderedNodes.length < 2) continue;

    const orderedEdges = [];
    for (let i = 0; i < orderedNodes.length - 1; i++) {
      const a = orderedNodes[i], b = orderedNodes[i+1];
      const key = keyForPair(a, b);
      const eid = pairToEdge.get(key);
      if (!eid) { // fallback: sök
        const found = edges.find(id => {
          const e = graph.getEdge(id);
          return (e.a === a && e.b === b) || (e.a === b && e.b === a);
        });
        if (!found) break;
        orderedEdges.push(found);
      } else {
        orderedEdges.push(keyForPair(a,b) && pairToEdge.get(key));
      }
    }
    if (orderedEdges.length !== orderedNodes.length - 1) continue;

    // 4) Plocka totalMm + distribution (första icke-null vinner)
    let totalMm = null, distribution = 'even';
    for (const eid of orderedEdges) {
      const em = graph.getEdge(eid)?.meta?.chain;
      if (em?.distribution && distribution === 'even') distribution = em.distribution;
      if (typeof em?.totalMm === 'number' && isFinite(em.totalMm)) { totalMm = em.totalMm; break; }
    }

    out.push({
      id: cid,
      edges: orderedEdges,
      nodes: orderedNodes,
      endA,
      endB,
      totalMm,
      distribution
    });
  }

  return out;
}

// Helpers
function keyForPair(a,b){ return (a < b) ? `${a}|${b}` : `${b}|${a}`; }

function orderNodesAlongChain(adj, start, goal, edgeCount){
  const out = [start];
  let prev = null, cur = start;
  let guard = 0;
  while (cur !== goal && guard < edgeCount+5) {
    guard++;
    const nbrs = [...(adj.get(cur) || [])];
    const next = nbrs.find(n => n !== prev);
    if (!next) break;
    out.push(next);
    prev = cur; cur = next;
  }
  return (cur === goal) ? out : null;
}

function collectComponentFromEdge(g, startEid) {
  const e0 = g.getEdge(startEid); if (!e0) return { nodes:[], edges:[] };
  const seenN = new Set(), seenE = new Set(); const q = [];
  seenN.add(e0.a); seenN.add(e0.b); q.push(e0.a, e0.b); seenE.add(startEid);
  while (q.length) {
    const nid = q.shift();
    const bag = g.incidentEdges(nid, {}); // alla kanter
    for (const e of bag) {
      if (!seenE.has(e.id)) seenE.add(e.id);
      const other = (e.a === nid) ? e.b : e.a;
      if (!seenN.has(other)) { seenN.add(other); q.push(other); }
    }
  }
  return { nodes:[...seenN], edges:[...seenE] };
}
