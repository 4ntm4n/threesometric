// ──────────────────────────────────────────────────────────────────────────────
// src/ops/slope.js  (med toggle: balanced | lockTop | lockBottom)
// ──────────────────────────────────────────────────────────────────────────────

const EPS = 1e-6;

// ——— helpers: world pos / set world Y
function getNodeWorldPos(graph, nodeId) {
  if (typeof graph.getNodeWorldPos === 'function') return graph.getNodeWorldPos(nodeId);
  const n = graph.nodes?.get(nodeId);
  if (!n) return { x:0, y:0, z:0 };
  if (n.pos) return n.pos;
  const b = n.base || { x:0, y:0, z:0 };
  const o = n.offset || { x:0, y:0, z:0 };
  return { x:(b.x??0)+(o.x??0), y:(b.y??0)+(o.y??0), z:(b.z??0)+(o.z??0) };
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
function hasHorizComp(pa, pb) { return horizDistXZ(pa, pb) > EPS; }

// ——— grannar & path
function* neighborsCenter(graph, nodeId) {
  if (typeof graph.neighbors === 'function') {
    const arr = graph.neighbors(nodeId, { kind: 'center' }) || [];
    for (const it of arr) yield it;
    return;
  }
  const bag = graph.adj?.get(nodeId); if (!bag) return;
  for (const eid of bag) {
    const e = graph.edges.get(eid);
    if (!e || e.kind !== 'center') continue;
    const otherId = (e.a === nodeId) ? e.b : e.a;
    yield { edge: e, otherId };
  }
}
function pathCenterAB(graph, aId, bId) {
  if (!graph?.nodes?.size) return null;
  const dist=new Map(), prev=new Map(), unvisited=new Set(graph.nodes.keys());
  for (const id of unvisited) dist.set(id, Infinity);
  dist.set(aId, 0);
  while (unvisited.size) {
    let u=null, best=Infinity;
    for (const id of unvisited) { const d=dist.get(id); if (d<best){best=d; u=id;} }
    if (u==null) break;
    unvisited.delete(u);
    if (u===bId) break;
    for (const { otherId } of neighborsCenter(graph, u)) {
      if (!unvisited.has(otherId)) continue;
      const alt = dist.get(u)+1;
      if (alt < dist.get(otherId)) { dist.set(otherId, alt); prev.set(otherId, u); }
    }
  }
  if (!prev.has(bId) && aId !== bId) return null;
  const path=[bId];
  for (let cur=bId; cur!==aId; ) { const p=prev.get(cur); if (p==null) return aId===bId?[aId]:null; path.push(p); cur=p; }
  path.reverse(); return path;
}

// ——— riser-mappning: håll riser vertikal (linjär Y topp→botten)
function mapRiserColumnY(riserNodes, yTop, yBottom) {
  const n=riserNodes.length, res=new Map();
  if (n===1) { res.set(riserNodes[0], yTop); return res; }
  for (let i=0;i<n;i++){ const t=i/(n-1); res.set(riserNodes[i], yTop + t*(yBottom - yTop)); }
  return res;
}

// ——— sektionering: riser–span–riser och split vid ankare
function buildSections(path, pos, anchorsSet) {
  const sections=[]; let i=0;
  while (i<path.length) {
    const riserNodes=[path[i]];
    while (i<path.length-1 && !hasHorizComp(pos.get(path[i]), pos.get(path[i+1]))) { i++; riserNodes.push(path[i]); }
    sections.push({ type:'riser', nodes:riserNodes });
    if (i>=path.length-1) break;
    const spanNodes=[path[i]];
    while (i<path.length-1 && hasHorizComp(pos.get(path[i]), pos.get(path[i+1]))) { i++; spanNodes.push(path[i]); }
    const cuts=[]; for (let k=1;k<spanNodes.length-1;k++) if (anchorsSet.has(spanNodes[k])) cuts.push(k);
    if (!cuts.length) sections.push({ type:'span', nodes:spanNodes });
    else {
      let start=0;
      for (const cut of cuts) {
        const sub=spanNodes.slice(start, cut+1); if (sub.length>=2) sections.push({ type:'span', nodes:sub });
        const anchorNode=spanNodes[cut]; sections.push({ type:'riser', nodes:[anchorNode] });
        start=cut;
      }
      const tail=spanNodes.slice(start); if (tail.length>=2) sections.push({ type:'span', nodes:tail });
    }
  }
  return sections;
}

/**
 * Togglebar slope-preview.
 * @param {object} graph
 * @param {id} aId  - högsta punkt (måste ha yA > yB för nu)
 * @param {id} bId  - punkt nedströms
 * @param {number} s - fall m/m (ex 0.01 = 1 %)
 * @param {object} [options]
 *   @param {'balanced'|'lockTop'|'lockBottom'} [options.mode='balanced']
 *   @param {Array<id>} [options.anchors]  extra ankare som splittrar span (A/B alltid)
 */
export function makeSlopePreviewOnPath(graph, aId, bId, s, options = {}) {
  const mode = options.mode ?? 'balanced';

  const path = pathCenterAB(graph, aId, bId);
  if (!path) return { ok:false, reason:'no_path' };

  // Pos & original Y
  const pos=new Map(); for (const nid of path) pos.set(nid, getNodeWorldPos(graph, nid));
  const yOrig=new Map(path.map(nid => [nid, pos.get(nid).y]));

  // A måste vara högre än B i grundläget (A==B → använd lockTop/lockBottom)
  const yA=yOrig.get(aId), yB=yOrig.get(bId);
  if (!(yA > yB + EPS) && mode === 'balanced') {
    return { ok:false, reason:'A_not_higher_than_B_for_balanced', details:{ yA, yB } };
  }

  // Ankare (A/B alltid)
  const anchorsSet=new Set(options.anchors ?? []);
  anchorsSet.add(aId); anchorsSet.add(bId);

  const sections=buildSections(path, pos, anchorsSet);
  const hasSpan = sections.some(s => s.type==='span');
  if (!hasSpan) {
    const yTargetByNode=new Map(path.map(nid => [nid, yOrig.get(nid)]));
    return { ok:true, path, yTargetByNode, affectedEdges:[], resultingSlope:0, warnings:[] };
  }

  const yNew=new Map(yOrig);
  const warnings=[];

  const riserTop    = (sct) => sct.nodes[0];
  const riserBottom = (sct) => sct.nodes[sct.nodes.length-1];

  // ——— helper: är en given endpoint låst i detta mode?
  function isUpEndpointAnchored(upTop, upBottom) {
    // up-endpoint = upBottom (botten på uppströms riser)
    return anchorsSet.has(upBottom) || mode === 'lockBottom';
  }
  function isDownEndpointAnchored(dnTop, dnBottom) {
    // down-endpoint = dnTop (topp på nedströms riser)
    return anchorsSet.has(dnTop) || mode === 'lockTop';
  }

  for (let si=0; si<sections.length; si++) {
    const span = sections[si];
    if (span.type !== 'span') continue;

    const riserUp   = sections[si-1];
    const riserDown = sections[si+1];

    const upTop    = riserTop(riserUp);
    const upBottom = riserBottom(riserUp);
    const dnTop    = riserTop(riserDown);
    const dnBottom = riserBottom(riserDown);

    // 1) per-kant drop (alltid >= 0 i flödesriktningen)
    let Dspan=0;
    const edgeDrops=[];
    for (let j=0;j<span.nodes.length-1;j++){
      const u=span.nodes[j], v=span.nodes[j+1];
      const pu=pos.get(u), pv=pos.get(v);
      const Lh=horizDistXZ(pu, pv);
      if (Lh<=EPS) continue;
      const dYorig = yOrig.get(u) - yOrig.get(v); // >0 = nedför
      if (Math.abs(dYorig) <= EPS) {
        const drop = s * Lh;
        Dspan += drop; edgeDrops.push({u,v,drop});
      } else if (dYorig > 0) {
        const drop = dYorig; // bevara diagonal nedför
        Dspan += drop; edgeDrops.push({u,v,drop});
      } else {
        const drop = s * Lh; // uppför → ersätt
        Dspan += drop; edgeDrops.push({u,v,drop});
        warnings.push({ type:'diag_uphill', edge:{u,v} });
      }
    }

    // 2) ändpunkter enligt mode/ankare
    const Up0=yNew.get(upBottom);
    const Dn0=yNew.get(dnTop);
    const anchoredUp = isUpEndpointAnchored(upTop, upBottom);
    const anchoredDn = isDownEndpointAnchored(dnTop, dnBottom);

    let Up, Dn;
    if (anchoredUp && anchoredDn) {
      // båda låsta (t.ex. enda spannet och A/B ankare):
      // vi kan inte flytta endpoints – ackumuleringen måste landa på Dn0.
      Up = Up0; Dn = Dn0;
      // (edgeDrops landar på Dn0 i steg 3; om numeriken diffar korrigerar vi sista kanten)
    } else if (anchoredUp) {
      // Up låst → allt D på nedströms
      Up = Up0;
      Dn = Up - Dspan;
    } else if (anchoredDn) {
      // Dn låst → allt D på uppströms
      Dn = Dn0;
      Up = Dn + Dspan;
    } else {
      // balanced: minimumnorm (½/½)
      const C = Dspan - (Up0 - Dn0);
      Up = Up0 + 0.5 * C;
      Dn = Dn0 - 0.5 * C;
    }

    yNew.set(upBottom, Up);
    yNew.set(dnTop,    Dn);

    // 3) ackumulera genom spannet (bevarar diagonaler)
    let yCur = Up;
    yNew.set(span.nodes[0], yCur);
    for (let j=0;j<edgeDrops.length;j++){
      const { v, drop } = edgeDrops[j];
      let yNext = yCur - drop;
      // Om båda endpoints låsta, se till att sista kantens drop landar exakt på Dn
      if (anchoredUp && anchoredDn && j === edgeDrops.length-1) {
        yNext = Dn;
      }
      yNew.set(v, yNext);
      yCur = yNext;
    }

    // 4) mappa risers vertikalt, med top/bottom låsta beroende på mode/anchors
    {
      const yTopU = (mode==='lockTop'    || anchorsSet.has(upTop))    ? yOrig.get(upTop)    : yNew.get(upTop);
      const yBotU = (mode==='lockBottom' || anchorsSet.has(upBottom)) ? yOrig.get(upBottom) : yNew.get(upBottom);
      const mapUp = mapRiserColumnY(riserUp.nodes, yTopU, yBotU);
      for (const [nid,y] of mapUp) yNew.set(nid, y);

      const yTopD = (mode==='lockTop'    || anchorsSet.has(dnTop))    ? yOrig.get(dnTop)    : yNew.get(dnTop);
      const yBotD = (mode==='lockBottom' || anchorsSet.has(dnBottom)) ? yOrig.get(dnBottom) : yNew.get(dnBottom);
      const mapDn = mapRiserColumnY(riserDown.nodes, yTopD, yBotD);
      for (const [nid,y] of mapDn) yNew.set(nid, y);
    }

    // 5) A/B exakt låsta
    yNew.set(aId, yA);
    yNew.set(bId, yB);
  }

  // ——— affected center-edges längs pathen
  const affected=new Set();
  for (let i=0;i<path.length-1;i++){
    const u=path[i], v=path[i+1];
    if (typeof graph.edgeBetween === 'function') {
      const e=graph.edgeBetween(u, v, { kind:'center' }); if (e) affected.add(e.id ?? e);
    } else {
      const bag=graph.adj?.get(u); if (!bag) continue;
      for (const eid of bag) {
        const e=graph.edges.get(eid);
        if (e?.kind==='center' && ((e.a===u&&e.b===v)||(e.a===v&&e.b===u))) affected.add(eid);
      }
    }
  }

  return { ok:true, path, yTargetByNode:yNew, affectedEdges:[...affected], warnings };
}

// ——— commit (propagera ENDAST till 3D-coincidanta noder, inte bara XZ)
export function applySlopePreview(graph, preview, opts = {}) {
  if (!preview?.ok) return { ok:false, reason:'no_preview' };

  const tolXZ = opts.coincidentTolXZ ?? 1e-4; // ~0.1 mm om modellen är i meter
  const tolY  = opts.coincidentTolY  ?? 1e-6; // mycket stramt i höjd

  const affectedNodes = new Set();
  const affectedEdges = new Set(preview.affectedEdges ?? []);

  // 0) Spara ALLA noders ursprungliga world-pos INNAN vi börjar flytta något
  const origAll = new Map();
  if (graph?.nodes?.size) {
    for (const [id] of graph.nodes) origAll.set(id, getNodeWorldPos(graph, id));
  }

  // 1) Flytta noder i preview och propagera till 3D-coincidanta tvillingar
  for (const [nid, yNew] of preview.yTargetByNode) {
    const base0 = origAll.get(nid) || getNodeWorldPos(graph, nid);

    // 1a) primärnoden
    setNodeWorldY(graph, nid, yNew);
    affectedNodes.add(nid);

    // 1b) propagera till andra noder som var samma 3D-punkt före flytt
    if (graph?.nodes?.size) {
      for (const [otherId] of graph.nodes) {
        if (otherId === nid) continue;
        const p0 = origAll.get(otherId);
        if (!p0) continue;

        const sameXZ = Math.abs(p0.x - base0.x) <= tolXZ && Math.abs(p0.z - base0.z) <= tolXZ;
        const sameY  = Math.abs(p0.y - base0.y) <= tolY;
        if (sameXZ && sameY) {
          setNodeWorldY(graph, otherId, yNew);
          affectedNodes.add(otherId);
        }
      }
    }
  }

  // 2) Utöka affectedEdges med alla center-edges som sitter i de flyttade noderna
  for (const nid of affectedNodes) {
    for (const { edge } of neighborsCenter(graph, nid)) {
      if (edge?.id != null) affectedEdges.add(edge.id);
    }
  }

  return {
    ok: true,
    affectedEdges: [...affectedEdges],
    affectedNodes: [...affectedNodes],
    path: preview.path
  };
}
