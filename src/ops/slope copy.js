// ──────────────────────────────────────────────────────────────────────────────
// src/ops/slope.js
// Slope A→B på center-nätet (svetsar-logik, diagonaler bevaras, ankare-respekt)
// ──────────────────────────────────────────────────────────────────────────────

const EPS = 1e-6;

// ——— helpers: world pos / set world Y (fallbacks om graph inte exponerar helpers)
function getNodeWorldPos(graph, nodeId) {
  if (typeof graph.getNodeWorldPos === 'function') return graph.getNodeWorldPos(nodeId);
  const n = graph.nodes?.get(nodeId);
  if (!n) return { x:0, y:0, z:0 };
  if (n.pos) return n.pos;
  const b = n.base || { x:0, y:0, z:0 };
  const o = n.offset || { x:0, y:0, z:0 };
  return {
    x: (b.x ?? 0) + (o.x ?? 0),
    y: (b.y ?? 0) + (o.y ?? 0),
    z: (b.z ?? 0) + (o.z ?? 0),
  };
}
function setNodeWorldY(graph, nodeId, yNew) {
  if (typeof graph.setNodeWorldY === 'function') { graph.setNodeWorldY(nodeId, yNew); return; }
  const n = graph.nodes?.get(nodeId); if (!n) return;
  if (n.pos) { n.pos.y = yNew; return; }
  if (!n.base)   n.base   = { x:0, y:0, z:0 };
  if (!n.offset) n.offset = { x:0, y:0, z:0 };
  const curY = (n.base.y ?? 0) + (n.offset.y ?? 0);
  n.offset.y = (n.offset.y ?? 0) + (yNew - curY);
}

// ——— geometri
function horizDistXZ(a, b) { const dx=b.x-a.x, dz=b.z-a.z; return Math.hypot(dx, dz); }
function hasHorizComp(pa, pb) { return horizDistXZ(pa, pb) > EPS; } // Lh>0

// ——— grannar: endast center-edges
function* neighborsCenter(graph, nodeId) {
  if (typeof graph.neighbors === 'function') {
    const arr = graph.neighbors(nodeId, { kind: 'center' }) || [];
    for (const it of arr) yield it; // { edge, otherId }
    return;
  }
  const bag = graph.adj?.get(nodeId);
  if (!bag) return;
  for (const eid of bag) {
    const e = graph.edges.get(eid);
    if (!e || e.kind !== 'center') continue;
    const otherId = (e.a === nodeId) ? e.b : e.a;
    yield { edge: e, otherId };
  }
}

// ——— enkel Dijkstra/BFS (alla center-edges vikt = 1)
function pathCenterAB(graph, aId, bId) {
  if (!graph?.nodes?.size) return null;

  const dist = new Map();
  const prev = new Map();
  const unvisited = new Set(graph.nodes.keys());

  for (const id of unvisited) dist.set(id, Infinity);
  dist.set(aId, 0);

  while (unvisited.size) {
    let u = null, best = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id);
      if (d < best) { best = d; u = id; }
    }
    if (u == null) break;
    unvisited.delete(u);
    if (u === bId) break;

    for (const { otherId } of neighborsCenter(graph, u)) {
      if (!unvisited.has(otherId)) continue;
      const alt = dist.get(u) + 1;
      if (alt < dist.get(otherId)) {
        dist.set(otherId, alt);
        prev.set(otherId, u);
      }
    }
  }

  if (!prev.has(bId) && aId !== bId) return null;

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

// ——— riser-mappning: håll en riser strikt vertikal (linjär Y topp→botten)
function mapRiserColumnY(riserNodes, yTop, yBottom) {
  const n = riserNodes.length;
  const res = new Map();
  if (n === 1) { res.set(riserNodes[0], yTop); return res; }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    res.set(riserNodes[i], yTop + t * (yBottom - yTop));
  }
  return res;
}

// ——— bygg sektioner: riser–span–riser–… och splittra span vid ankare
function buildSections(path, pos, anchorsSet) {
  const sections = [];
  let i = 0;
  while (i < path.length) {
    // riser (Lh≈0)
    const riserNodes = [path[i]];
    while (i < path.length - 1 && !hasHorizComp(pos.get(path[i]), pos.get(path[i+1]))) {
      i++; riserNodes.push(path[i]);
    }
    sections.push({ type:'riser', nodes:riserNodes });

    if (i >= path.length - 1) break;

    // span (Lh>0)
    const spanNodes = [path[i]];
    while (i < path.length - 1 && hasHorizComp(pos.get(path[i]), pos.get(path[i+1]))) {
      i++; spanNodes.push(path[i]);
    }

    // splittra span vid inneliggande ankare (exkl. endpoints)
    const cuts = [];
    for (let k=1;k<spanNodes.length-1;k++) if (anchorsSet.has(spanNodes[k])) cuts.push(k);
    if (cuts.length===0) {
      sections.push({ type:'span', nodes:spanNodes });
    } else {
      let start = 0;
      for (const cut of cuts) {
        const sub = spanNodes.slice(start, cut+1);
        if (sub.length>=2) sections.push({ type:'span', nodes:sub });
        const anchorNode = spanNodes[cut];
        sections.push({ type:'riser', nodes:[anchorNode] }); // degenererad riser
        start = cut;
      }
      const tail = spanNodes.slice(start);
      if (tail.length>=2) sections.push({ type:'span', nodes:tail });
    }
  }
  return sections;
}

/**
 * Preview av slope längs A→B.
 *  - A måste vara högre än B (enkelt grundkrav).
 *  - Span får bara nedför: horisontell → s*Lh, diagonal nedför → bevaras, diagonal uppför → s*Lh.
 *  - Ändpunkter respekt för ankare (A/B, och optional extra).
 */
export function makeSlopePreviewOnPath(graph, aId, bId, s, options = {}) {
  const path = pathCenterAB(graph, aId, bId);
  if (!path) return { ok:false, reason:'no_path' };

  // Pos & original Y
  const pos = new Map();
  for (const nid of path) pos.set(nid, getNodeWorldPos(graph, nid));
  const yOrig = new Map(path.map(nid => [nid, pos.get(nid).y]));

  // Validera: A högre än B
  const yA = yOrig.get(aId), yB = yOrig.get(bId);
  if (!(yA > yB + EPS)) {
    return { ok:false, reason:'A_not_higher_than_B', details:{ yA, yB } };
  }

  // Ankar-set (A & B alltid)
  const anchorsSet = new Set(options.anchors ?? []);
  anchorsSet.add(aId); anchorsSet.add(bId);

  // Sektioner
  const sections = buildSections(path, pos, anchorsSet);

  // Ingen span → klart
  const hasSpan = sections.some(sct => sct.type === 'span');
  if (!hasSpan) {
    const yTargetByNode = new Map(path.map(nid => [nid, yOrig.get(nid)]));
    return { ok:true, path, yTargetByNode, affectedEdges: [], resultingSlope: 0, warnings: [] };
  }

  const yNew = new Map(yOrig);
  const warnings = [];

  // helpers
  const riserTop    = (sct) => sct.nodes[0];
  const riserBottom = (sct) => sct.nodes[sct.nodes.length - 1];

  // Processera span i ordning
  for (let si = 0; si < sections.length; si++) {
    const span = sections[si];
    if (span.type !== 'span') continue;

    const riserUp   = sections[si - 1];
    const riserDown = sections[si + 1];

    const upTop    = riserTop(riserUp);
    const upBottom = riserBottom(riserUp);
    const dnTop    = riserTop(riserDown);
    const dnBottom = riserBottom(riserDown);

    // 1) Per-kant drop i spannet (alltid positivt)
    let Dspan = 0;
    const edgeDrops = []; // [{u,v,drop}]
    for (let j = 0; j < span.nodes.length - 1; j++) {
      const u = span.nodes[j], v = span.nodes[j+1];
      const pu = pos.get(u), pv = pos.get(v);
      const Lh = horizDistXZ(pu, pv);
      if (Lh <= EPS) continue;
      const dYorig = yOrig.get(u) - yOrig.get(v); // >0 = nedför mot v
      if (Math.abs(dYorig) <= EPS) {
        const drop = s * Lh;
        Dspan += drop; edgeDrops.push({ u, v, drop });
      } else if (dYorig > 0) {
        const drop = dYorig;              // bevara diagonal nedför
        Dspan += drop; edgeDrops.push({ u, v, drop });
      } else {
        const drop = s * Lh;              // uppför → ersätt med s*Lh
        Dspan += drop; edgeDrops.push({ u, v, drop });
        warnings.push({ type:'diag_uphill', edge:{ u, v } });
      }
    }

    // 2) Ändpunkter med ankare-respekt
    const Up0 = yNew.get(upBottom);
    const Dn0 = yNew.get(dnTop);
    const anchoredUp = anchorsSet.has(upBottom);
    const anchoredDn = anchorsSet.has(dnTop);

    let Up, Dn;
    if (anchoredUp && anchoredDn) {
      // båda låsta
      Up = Up0; Dn = Dn0;
    } else if (anchoredUp) {
      // A-sida låst ⇒ allt fall på nedströms
      Up = Up0;
      Dn = Up - Dspan;
    } else if (anchoredDn) {
      // B-sida låst ⇒ allt fall på uppströms
      Dn = Dn0;
      Up = Dn + Dspan;
    } else {
      // ingen låst ⇒ minimumnorm (½/½)
      const C = Dspan - (Up0 - Dn0);
      Up = Up0 + 0.5 * C;
      Dn = Dn0 - 0.5 * C;
    }

    yNew.set(upBottom, Up);
    yNew.set(dnTop,    Dn);

    // 3) Sekventiell ackumulation genom spannet (ingen bakfall)
    let yCur = Up;
    yNew.set(span.nodes[0], yCur);
    for (let j = 0; j < edgeDrops.length; j++) {
      const { v, drop } = edgeDrops[j];
      const yNext = yCur - drop; // strikt nedför
      yNew.set(v, yNext);
      yCur = yNext;
    }

    // Om nedströms ändpunkt var ankare: landa exakt på Dn
    yNew.set(span.nodes[span.nodes.length - 1], Dn);

    // 4) Riser-mappning (topp→botten) med ankarskydd på topp/botten där relevant
    {
      const yTopU = anchorsSet.has(upTop) ? yOrig.get(upTop) : yNew.get(upTop);
      const yBotU = yNew.get(upBottom);
      const mapUp = mapRiserColumnY(riserUp.nodes, yTopU, yBotU);
      for (const [nid, y] of mapUp) yNew.set(nid, y);

      const yTopD = yNew.get(dnTop);
      const yBotD = anchorsSet.has(dnBottom) ? yOrig.get(dnBottom) : yNew.get(dnBottom);
      const mapDn = mapRiserColumnY(riserDown.nodes, yTopD, yBotD);
      for (const [nid, y] of mapDn) yNew.set(nid, y);
    }

    // 5) A/B låsta (extra säkerhet)
    yNew.set(aId, yA);
    yNew.set(bId, yB);
  }

  // Packa preview — berörda edges = center-edges längs pathen
  const affected = new Set();
  for (let k = 0; k < path.length - 1; k++) {
    const u = path[k], v = path[k+1];
    if (typeof graph.edgeBetween === 'function') {
      const e = graph.edgeBetween(u, v, { kind: 'center' });
      if (e) affected.add(e.id ?? e);
    } else {
      const bag = graph.adj?.get(u);
      if (!bag) continue;
      for (const eid of bag) {
        const e = graph.edges.get(eid);
        if (e?.kind === 'center' && ((e.a===u&&e.b===v) || (e.a===v&&e.b===u))) affected.add(eid);
      }
    }
  }

  return { ok:true, path, yTargetByNode: yNew, affectedEdges:[...affected], warnings };
}

// ——— commit
export function applySlopePreview(graph, preview) {
  if (!preview?.ok) return { ok:false, reason:'no_preview' };
  for (const [nid, y] of preview.yTargetByNode) setNodeWorldY(graph, nid, y);
  return { ok:true, affectedEdges: preview.affectedEdges, path: preview.path };
}
